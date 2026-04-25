"""
NVD CVE lookup wrapper.

Wraps `nvdlib.searchCVE` with:
  - rate-limit-aware delay (1.2s with API key, 6.0s without)
  - normalisation to a CVERecord dataclass so downstream code does not depend
    on nvdlib's object shape (which changes occasionally between releases)
  - graceful handling of missing CVSSv3 scores (fall back to severity bucket
    UNKNOWN; the caller decides whether to drop or keep)
  - bounded retry on transient network errors

Direct entry point: `query_cves(tech, version, api_key=None)`.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

# CVSSv3.1 severity boundaries per
# https://www.first.org/cvss/v3.1/specification-document#5-Qualitative-Severity-Rating-Scale
SEVERITY_THRESHOLDS = (
    (9.0, "CRITICAL"),
    (7.0, "HIGH"),
    (4.0, "MEDIUM"),
    (0.1, "LOW"),
)

# Rate-limit delays per NVD docs:
#   with API key:    50 req / 30s  ⇒ 0.6 s/req minimum, use 1.2 for headroom
#   without key:      5 req / 30s  ⇒ 6.0 s/req minimum
DELAY_WITH_KEY = 1.2
DELAY_WITHOUT_KEY = 6.0

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2.0  # seconds; doubled per attempt


@dataclass(frozen=True)
class CVERecord:
    """Normalised CVE record. Frozen so it can live in sets and be hashed."""

    cve_id: str
    cvss_score: Optional[float]
    severity: str
    vector: Optional[str] = None
    description: str = ""

    @property
    def is_critical(self) -> bool:
        return self.cvss_score is not None and self.cvss_score >= 9.0


def severity_for(score: Optional[float]) -> str:
    """Map a CVSSv3.1 base score to the official severity bucket."""
    if score is None:
        return "UNKNOWN"
    for threshold, label in SEVERITY_THRESHOLDS:
        if score >= threshold:
            return label
    return "NONE"


def _delay_for(api_key: Optional[str]) -> float:
    return DELAY_WITH_KEY if api_key else DELAY_WITHOUT_KEY


def _build_keyword(tech: str, version: Optional[str]) -> str:
    """nvdlib's keywordSearch matches on the full string. The spec calls for
    converting `nginx-1.18.0` to `nginx 1.18.0` so the NVD's CPE matcher has
    a fighting chance. Strip empty/None versions cleanly."""
    if version:
        return f"{tech} {version}".strip()
    return tech.strip()


def _normalise(raw) -> CVERecord:
    """Convert an nvdlib CVE result into our CVERecord dataclass.

    nvdlib results expose attributes; some are sometimes absent (older CVEs
    without CVSSv3). We accept that and let `severity_for` map None to
    UNKNOWN.
    """
    cve_id = getattr(raw, "id", "")
    score = getattr(raw, "v31score", None)
    # Some library versions name this `v31severity` already as a string;
    # if missing, derive it from the score.
    raw_severity = getattr(raw, "v31severity", None)
    severity = raw_severity or severity_for(score)
    vector = getattr(raw, "v31vector", None)

    # `descriptions` is sometimes a list of objects; fall back to a string
    # representation if available.
    descriptions = getattr(raw, "descriptions", None)
    if isinstance(descriptions, list) and descriptions:
        description = getattr(descriptions[0], "value", "") or ""
    else:
        description = ""

    return CVERecord(
        cve_id=cve_id,
        cvss_score=score,
        severity=severity,
        vector=vector,
        description=description,
    )


def query_cves(
    tech: str,
    version: Optional[str] = None,
    api_key: Optional[str] = None,
    *,
    nvdlib_module=None,  # injected for testing
) -> list[CVERecord]:
    """Query NVD for CVEs matching `tech version` and return normalised records.

    Returns an empty list when nvdlib raises after all retries — callers should
    treat "no CVEs found" and "lookup failed" identically for triage purposes
    but the failure is logged at WARNING level.
    """
    if nvdlib_module is None:
        import nvdlib  # imported lazily so tests can run without the dep
        nvdlib_module = nvdlib

    keyword = _build_keyword(tech, version)
    if not keyword:
        return []

    api_key = api_key or os.getenv("NVD_API_KEY")
    delay = _delay_for(api_key)

    last_exc: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            raw_iter: Iterable = nvdlib_module.searchCVE(
                keywordSearch=keyword,
                key=api_key,
                delay=delay,
            )
            return [_normalise(r) for r in raw_iter]
        except Exception as e:  # nvdlib raises a small zoo of exceptions
            last_exc = e
            sleep = RETRY_BACKOFF_BASE * (2 ** (attempt - 1))
            logger.warning(
                "NVD lookup for %r failed (attempt %d/%d): %s; retrying in %.1fs",
                keyword, attempt, MAX_RETRIES, e, sleep,
            )
            time.sleep(sleep)

    logger.error("NVD lookup for %r exhausted retries: %s", keyword, last_exc)
    return []


@dataclass
class TargetReport:
    """One target's CVE intelligence as consumed by triage_writer."""

    url: str
    technologies: list[str] = field(default_factory=list)
    cves_by_severity: dict[str, list[CVERecord]] = field(default_factory=dict)

    @property
    def priority(self) -> str:
        """A target is CRITICAL if any CVE is CRITICAL. Spec FR-3."""
        critical = self.cves_by_severity.get("CRITICAL", [])
        return "CRITICAL" if critical else "NORMAL"

    @property
    def critical_count(self) -> int:
        return len(self.cves_by_severity.get("CRITICAL", []))


def group_by_severity(cves: Iterable[CVERecord]) -> dict[str, list[CVERecord]]:
    """Group records by severity bucket; preserves the order CRITICAL → LOW
    so the markdown report reads from highest to lowest."""
    order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN", "NONE"]
    grouped: dict[str, list[CVERecord]] = {k: [] for k in order}
    for cve in cves:
        bucket = cve.severity if cve.severity in grouped else "UNKNOWN"
        grouped[bucket].append(cve)
    # Drop empty buckets so the report only shows what's there.
    return {k: v for k, v in grouped.items() if v}
