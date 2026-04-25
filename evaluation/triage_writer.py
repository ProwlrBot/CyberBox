"""
Triage report formatter.

Renders a `TargetReport` as a markdown section and atomically appends it to
`triage.md`. The formatter (`render_target`) is pure — given a TargetReport
it returns a markdown string. The `append_to_triage` function is the only
side-effecting entry point.

Atomic append: write to a temp file in the same directory, then rename. This
avoids partial writes on disk-full / SIGKILL during a long batch of NVD
lookups.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from cve_lookup import CVERecord, TargetReport

PRIORITY_ICON = {
    "CRITICAL": "🔴",
    "NORMAL": "🟢",
}


def render_cve(cve: CVERecord) -> str:
    """Render a single CVE as a single-line markdown bullet."""
    score = f"CVSS {cve.cvss_score:.1f}" if cve.cvss_score is not None else "no CVSSv3"
    line = f"- **{cve.cve_id}** ({score})"
    if cve.description:
        # Trim very long descriptions; first sentence usually carries the
        # essence and keeps the report readable.
        first_sentence = cve.description.split(". ")[0].rstrip(".")
        line += f" — {first_sentence}"
    if cve.vector:
        line += f"\n  - Vector: `{cve.vector}`"
    return line


def render_target(report: TargetReport) -> str:
    """Render a TargetReport as a self-contained markdown section."""
    lines: list[str] = []
    lines.append(f"## Target: {report.url}")
    lines.append("")

    if report.technologies:
        lines.append("### Detected Technologies")
        for tech in report.technologies:
            lines.append(f"- {tech}")
        lines.append("")

    if report.cves_by_severity:
        lines.append("### CVE Findings")
        lines.append("")
        for severity, cves in report.cves_by_severity.items():
            if not cves:
                continue
            label = severity if severity != "UNKNOWN" else "UNKNOWN (no CVSSv3)"
            lines.append(f"#### {label}")
            for cve in cves:
                lines.append(render_cve(cve))
            lines.append("")
    else:
        lines.append("### CVE Findings")
        lines.append("")
        lines.append("_No known CVEs for declared technologies._")
        lines.append("")

    icon = PRIORITY_ICON.get(report.priority, "🟢")
    lines.append(f"### Priority: {icon} {report.priority}")
    if report.priority == "CRITICAL":
        lines.append(
            f"_Auto-prioritized due to {report.critical_count} critical CVE(s)._"
        )
    lines.append("")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def render_header() -> str:
    """Initial header for a fresh triage.md."""
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return (
        "# Reconnaissance Triage Report\n"
        f"_Generated {timestamp}_\n\n"
        "---\n\n"
    )


def append_to_triage(triage_path: Path, reports: Iterable[TargetReport]) -> None:
    """Atomically append rendered target sections to `triage_path`.

    If the file does not exist, prepend `render_header()`. If it does exist,
    we append without rewriting the existing content.
    """
    triage_path = Path(triage_path)
    triage_path.parent.mkdir(parents=True, exist_ok=True)

    new_content_parts: list[str] = []
    if not triage_path.exists():
        new_content_parts.append(render_header())
    for report in reports:
        new_content_parts.append(render_target(report))
    new_content = "".join(new_content_parts)
    if not new_content:
        return  # nothing to append

    # Atomic append: read existing, concatenate, write to temp, rename.
    existing = triage_path.read_text() if triage_path.exists() else ""
    final_text = existing + new_content

    fd, tmp_path = tempfile.mkstemp(
        prefix=".triage-",
        suffix=".tmp",
        dir=triage_path.parent,
    )
    try:
        with os.fdopen(fd, "w") as f:
            f.write(final_text)
        os.replace(tmp_path, triage_path)
    except Exception:
        # Cleanup the temp file if rename failed
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass
        raise
