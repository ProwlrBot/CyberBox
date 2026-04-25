"""
phase_recon — CVE intelligence module.

Pipeline:
  1. Read httpx tech-detect JSON output
  2. For each target, parse out (tech, version) pairs
  3. Look up CVEs for each (tech, version) via cve_lookup.query_cves
  4. Group CVEs by CVSS severity
  5. Hand off to triage_writer.append_to_triage

Designed to be runnable both as a CLI (`python -m phase_recon …`) and as a
function call from a higher-level orchestrator (e.g. agent_loop). The CLI
path reads a path to httpx output; the function path takes the parsed list
directly so tests don't have to touch the filesystem.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Iterable, Optional

from cve_lookup import (
    CVERecord,
    TargetReport,
    group_by_severity,
    query_cves,
)
from triage_writer import append_to_triage

logger = logging.getLogger(__name__)

# httpx emits one JSON object per line. The `technologies` field is a list of
# strings, sometimes with version suffixes joined by `-` (e.g. "nginx-1.18.0",
# "wordpress-5.8") and sometimes bare (e.g. "wordpress").
TECH_VERSION_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_+./-]*?)-(\d+(?:\.\d+)*[a-zA-Z0-9]*)$")


def parse_tech_string(tech: str) -> tuple[str, Optional[str]]:
    """Split a tech string into (name, version-or-None).

    Examples:
        "nginx-1.18.0"   -> ("nginx", "1.18.0")
        "wordpress-5.8"  -> ("wordpress", "5.8")
        "wordpress"      -> ("wordpress", None)
        "x-frame-deny"   -> ("x-frame-deny", None)  # no trailing version
    """
    tech = tech.strip()
    m = TECH_VERSION_RE.match(tech)
    if m:
        return m.group(1), m.group(2)
    return tech, None


def parse_httpx_targets(httpx_lines: Iterable[str]) -> list[dict]:
    """Parse httpx -json output (one object per line) into [{url, technologies}, ...].

    Skips malformed lines, missing-tech targets, and non-string technologies.
    httpx names the field `tech` in some versions and `technologies` in others;
    we accept both.
    """
    targets = []
    for raw_line in httpx_lines:
        line = raw_line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            logger.warning("skipping malformed httpx line: %s", line[:120])
            continue

        url = obj.get("url") or obj.get("input")
        if not url:
            logger.warning("skipping httpx record without url field")
            continue

        techs = obj.get("technologies") or obj.get("tech") or []
        if not isinstance(techs, list):
            logger.warning("skipping target %s: technologies is not a list", url)
            continue

        # Filter to strings only — httpx sometimes emits objects under `tech`
        techs = [t for t in techs if isinstance(t, str) and t.strip()]
        targets.append({"url": url, "technologies": techs})
    return targets


def build_target_report(
    target: dict,
    *,
    api_key: Optional[str] = None,
    nvdlib_module=None,
) -> TargetReport:
    """Look up CVEs for one target and return a TargetReport."""
    url = target["url"]
    techs: list[str] = target.get("technologies", [])

    all_cves: list[CVERecord] = []
    for tech_str in techs:
        name, version = parse_tech_string(tech_str)
        if not version:
            # Spec DON'T: do not query NVD with bare names that match
            # everything (`linux`, `apache`). Skip and warn.
            logger.info(
                "skipping NVD lookup for %r on %s: no version detected", name, url,
            )
            continue
        cves = query_cves(name, version, api_key=api_key, nvdlib_module=nvdlib_module)
        all_cves.extend(cves)

    return TargetReport(
        url=url,
        technologies=techs,
        cves_by_severity=group_by_severity(all_cves),
    )


def run_phase_recon(
    httpx_output_path: str | Path,
    triage_path: str | Path,
    *,
    api_key: Optional[str] = None,
    nvdlib_module=None,
) -> list[TargetReport]:
    """Read httpx output, query NVD, append to triage.md. Returns reports."""
    httpx_output_path = Path(httpx_output_path)
    triage_path = Path(triage_path)

    if not httpx_output_path.exists():
        raise FileNotFoundError(f"httpx output not found: {httpx_output_path}")

    with httpx_output_path.open() as f:
        targets = parse_httpx_targets(f)

    logger.info("phase_recon: %d targets parsed from %s", len(targets), httpx_output_path)

    reports = [
        build_target_report(t, api_key=api_key, nvdlib_module=nvdlib_module)
        for t in targets
    ]
    append_to_triage(triage_path, reports)

    critical = sum(1 for r in reports if r.priority == "CRITICAL")
    logger.info(
        "phase_recon: wrote %d targets to %s (%d CRITICAL)",
        len(reports), triage_path, critical,
    )
    return reports


def _cli() -> int:
    parser = argparse.ArgumentParser(
        description="phase_recon — query NVD for CVEs matching httpx tech-detect output",
    )
    parser.add_argument(
        "httpx_output",
        help="Path to httpx -json output (one JSON object per line)",
    )
    parser.add_argument(
        "--triage",
        default="triage.md",
        help="Path to triage report (created if missing). Default: triage.md",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="NVD API key. Falls back to NVD_API_KEY env var. Strongly recommended.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    api_key = args.api_key or os.getenv("NVD_API_KEY")
    if not api_key:
        logger.warning(
            "no NVD_API_KEY set; falling back to %.1fs delay between requests",
            6.0,
        )

    try:
        reports = run_phase_recon(
            args.httpx_output, args.triage, api_key=api_key,
        )
    except FileNotFoundError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    print(f"phase_recon: {len(reports)} targets written to {args.triage}")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
