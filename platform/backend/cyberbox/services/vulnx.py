"""vulnx engine driver — ProjectDiscovery vulnerability.sh intel as a coverage source.

Shells out to the `vulnx` CLI (search by affected product) and normalises each record into a
flat hit dict the engine layer can map onto the taxonomy. Unlike the NVD sweep, vulnx records
carry tags/CWE (so a hit can flip a *specific* class) plus KEV / EPSS / nuclei-template flags
(prioritisation signal). Every call is bounded by a hard timeout and never raises — a missing
binary, a network hiccup or malformed JSON yields an empty list, not an exception.

Note: vulnx queries an external service (vulnerability.sh) with the given product keywords. It is
on-demand only (a sweep the operator triggers), never automatic, and sends only generic tech
names — never target hosts, accounts or any project-private data.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

# Only safe query atoms: a product keyword is alnum + space/dot/dash/underscore/plus, lowercased.
# Anything else is stripped so a tech string can never inject vulnx query-filter syntax.
_CLEAN = re.compile(r"[^a-z0-9 ._+-]")


def _bin() -> str | None:
    found = shutil.which("vulnx")
    if found:
        return found
    cand = Path.home() / "go" / "bin" / "vulnx"
    return str(cand) if cand.exists() else None


def available() -> bool:
    return _bin() is not None


def _clean_product(tech: str) -> str:
    return _CLEAN.sub("", (tech or "").strip().lower()).strip()


def _normalize(rec: dict, tech: str) -> dict | None:
    cve = (rec.get("cve_id") or rec.get("id") or "").strip()
    if not cve:
        return None
    cwe = rec.get("cwe")
    cwe_list = cwe if isinstance(cwe, list) else ([cwe] if cwe else [])
    tags = rec.get("tags") if isinstance(rec.get("tags"), list) else []
    return {
        "cve_id": cve, "tech": tech,
        "severity": (rec.get("severity") or "").lower() or None,
        "cvss_score": rec.get("cvss_score"),
        "epss_score": rec.get("epss_score"),
        "is_kev": bool(rec.get("is_kev")),
        "is_poc": bool(rec.get("is_poc")),
        "is_template": bool(rec.get("is_template")),
        "cwe": [str(c) for c in cwe_list],
        "tags": [str(t).lower() for t in tags],
        "name": rec.get("name") or rec.get("description", "")[:120],
        "description": rec.get("description") or "",
    }


def search(techs: list[str], *, kev_only: bool = False, template_only: bool = False,
           limit: int = 10, timeout: int = 30) -> list[dict]:
    """Search vulnerability.sh for CVEs affecting each tech. Returns normalised, CVE-deduped hits.

    Never raises: returns [] if the binary is absent or every query fails."""
    binary = _bin()
    if not binary:
        return []
    seen: set[str] = set()
    out: list[dict] = []
    for tech in techs:
        product = _clean_product(tech)
        if not product:
            continue
        query = f"affected_products.product:{product}"
        if kev_only:
            query += " is_kev:true"
        if template_only:
            query += " is_template:true"
        try:
            proc = subprocess.run(
                [binary, "search", "--json", "--silent", "--disable-update-check",
                 "-n", str(max(1, min(limit, 100))), query],
                capture_output=True, text=True, timeout=timeout, check=False)
        except (subprocess.TimeoutExpired, OSError):
            continue
        if proc.returncode != 0 or not proc.stdout.strip():
            continue
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            continue
        rows = data if isinstance(data, list) else (data.get("results") or data.get("data") or [])
        for rec in rows if isinstance(rows, list) else []:
            if not isinstance(rec, dict):
                continue
            hit = _normalize(rec, tech)
            if hit and hit["cve_id"] not in seen:
                seen.add(hit["cve_id"])
                out.append(hit)
    # KEV first, then EPSS, then CVSS — surface what actually gets exploited.
    out.sort(key=lambda h: (h["is_kev"], h.get("epss_score") or 0.0, h.get("cvss_score") or 0.0),
             reverse=True)
    return out
