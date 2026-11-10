"""
CyberBox CVE intel service — stdlib-only NVD 2.0 API bridge.

Queries the NVD CVE 2.0 API for HIGH/CRITICAL CVEs matching a tech keyword,
normalises results, and returns them ready for posting as hypotheses.

Never raises on network errors — returns empty list with stderr warning.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone


NVD_API = "https://services.nvd.nist.gov/rest/json/cves/2.0"

# NVD rate limits:  50 req/30s with key, 5 req/30s without
_DELAY_WITH_KEY    = 1.2
_DELAY_WITHOUT_KEY = 6.0
_MAX_RESULTS       = 20   # keep sweeps focused


@dataclass
class CVEHit:
    cve_id:      str
    tech:        str
    description: str
    cvss_score:  float | None
    severity:    str            # CRITICAL HIGH MEDIUM LOW UNKNOWN
    vector:      str | None
    published:   str            # ISO-8601
    references:  list[str] = field(default_factory=list)

    def to_hypothesis_body(self, project_id: str) -> dict:
        score_str = f"{self.cvss_score:.1f}" if self.cvss_score is not None else "?"
        return {
            "title": f"[CVE] {self.cve_id} — {self.tech} ({self.severity} {score_str})",
            "description": self.description[:800],
            "severity": self.severity.lower(),
            "status": "open",
            "evidence": json.dumps({
                "source": "cve_sweep",
                "cve_id": self.cve_id,
                "tech": self.tech,
                "cvss_score": self.cvss_score,
                "vector": self.vector,
                "published": self.published,
                "references": self.references[:3],
            }),
        }


def _severity_for(score: float | None) -> str:
    if score is None:
        return "UNKNOWN"
    if score >= 9.0:
        return "CRITICAL"
    if score >= 7.0:
        return "HIGH"
    if score >= 4.0:
        return "MEDIUM"
    return "LOW"


def _nvd_search(
    keyword: str,
    *,
    cvss_min: float = 7.0,
    api_key: str = "",
    days_back: int = 90,
    timeout: int = 15,
) -> list[CVEHit]:
    """Query NVD CVE 2.0 API for a keyword.  Returns CVEHit list, never raises."""
    delay = _DELAY_WITH_KEY if api_key else _DELAY_WITHOUT_KEY

    pub_start = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime(
        "%Y-%m-%dT%H:%M:%S.000"
    )
    params = {
        "keywordSearch": keyword,
        "resultsPerPage": _MAX_RESULTS,
        "pubStartDate": pub_start,
    }
    url = NVD_API + "?" + urllib.parse.urlencode(params)

    headers: dict[str, str] = {"Accept": "application/json"}
    if api_key:
        headers["apiKey"] = api_key

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
    except Exception as exc:
        print(f"[cve_service] NVD API error for '{keyword}': {exc}", file=sys.stderr)
        return []

    time.sleep(delay)

    hits: list[CVEHit] = []
    for item in data.get("vulnerabilities", []):
        cve = item.get("cve", {})
        cve_id = cve.get("id", "")
        published = cve.get("published", "")

        # description — prefer English
        descriptions = cve.get("descriptions", [])
        desc = next(
            (d["value"] for d in descriptions if d.get("lang") == "en"),
            descriptions[0]["value"] if descriptions else "",
        )

        # CVSS v3.1 preferred, fall back to v3.0, then v2
        score: float | None = None
        vector: str | None = None
        metrics = cve.get("metrics", {})
        for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
            entries = metrics.get(key, [])
            if entries:
                data_v = entries[0].get("cvssData", {})
                score = data_v.get("baseScore")
                vector = data_v.get("vectorString")
                break

        severity = _severity_for(score)
        if score is not None and score < cvss_min:
            continue

        refs = [
            r["url"]
            for r in cve.get("references", [])[:5]
            if r.get("url")
        ]

        hits.append(CVEHit(
            cve_id=cve_id,
            tech=keyword,
            description=desc,
            cvss_score=score,
            severity=severity,
            vector=vector,
            published=published,
            references=refs,
        ))

    return hits


def sweep(
    techs: list[str],
    *,
    cvss_min: float = 7.0,
    api_key: str = "",
    days_back: int = 90,
) -> list[CVEHit]:
    """Run NVD sweep for every tech in the list.  Rate-limited, never raises."""
    results: list[CVEHit] = []
    for tech in techs:
        hits = _nvd_search(tech, cvss_min=cvss_min, api_key=api_key, days_back=days_back)
        results.extend(hits)
    # deduplicate by CVE ID (same CVE can match multiple tech keywords)
    seen: set[str] = set()
    deduped: list[CVEHit] = []
    for h in results:
        if h.cve_id not in seen:
            seen.add(h.cve_id)
            deduped.append(h)
    return sorted(deduped, key=lambda h: (h.cvss_score or 0.0), reverse=True)
