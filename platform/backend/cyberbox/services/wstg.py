"""OWASP WSTG v4.2 coverage — a second authoritative axis over the taxonomy spine.

The 96 WSTG top-level tests are seeded by taxonomy.ensure_seeded(); each test maps to zero or
more taxonomy classes (wstg_class_map). A test's per-target coverage is DERIVED from the existing
target_coverage ledger through that mapping — nothing here writes coverage. So the same real
evidence that flips a taxonomy class (a nuclei hit, a fingerprint observation, a manual mark) also
advances WSTG coverage, and a test with no mapping is honestly surfaced as "catalog-only" rather
than silently counted as done.

Derivation rule for a mapped test, over its mapped classes' statuses on the target:
  any class 'covered'  -> 'covered'
  else any 'partial'   -> 'partial'
  else                 -> 'none'
An unmapped (catalog-only) test is always 'none' and flagged so the UI never treats it as covered.
"""
from __future__ import annotations

import json as _json

from .. import db

_RANK = {"none": 0, "partial": 1, "covered": 2}
_BY_RANK = {v: k for k, v in _RANK.items()}

# Canonical OWASP WSTG v4.2 chapter order (SQL ORDER BY chapter would sort alphabetically).
_CHAPTER_ORDER = ["INFO", "CONF", "IDNT", "ATHN", "ATHZ", "SESS", "INPV", "ERRH", "CRYP", "BUSL", "CLNT"]
_CHAPTER_NAMES = {
    "INFO": "Information Gathering", "CONF": "Configuration and Deploy Management",
    "IDNT": "Identity Management", "ATHN": "Authentication", "ATHZ": "Authorization",
    "SESS": "Session Management", "INPV": "Input Validation", "ERRH": "Error Handling",
    "CRYP": "Weak Cryptography", "BUSL": "Business Logic", "CLNT": "Client-side",
}


def _chapter_rank(code: str) -> int:
    return _CHAPTER_ORDER.index(code) if code in _CHAPTER_ORDER else len(_CHAPTER_ORDER)


def catalog() -> dict:
    """The full WSTG v4.2 catalog: chapters (with counts) and every test with its mapped classes."""
    tests = db.query("SELECT * FROM wstg_tests ORDER BY chapter, num")
    maps = db.query("SELECT w.wstg_id, w.class_id, c.name "
                    "FROM wstg_class_map w JOIN taxonomy_classes c ON c.id = w.class_id")
    by_test: dict[str, list[dict]] = {}
    for m in maps:
        by_test.setdefault(m["wstg_id"], []).append({"class_id": m["class_id"], "name": m["name"]})
    out_tests = []
    chapters: dict[str, int] = {}
    for t in tests:
        chapters[t["chapter"]] = chapters.get(t["chapter"], 0) + 1
        out_tests.append({**t, "maps": by_test.get(t["id"], [])})
    out_tests.sort(key=lambda t: (_chapter_rank(t["chapter"]), t["num"]))
    return {"total": len(out_tests),
            "chapters": [{"code": c, "name": _CHAPTER_NAMES.get(c, c), "count": chapters[c]}
                         for c in sorted(chapters, key=_chapter_rank)],
            "tests": out_tests}


def coverage(project_id: str) -> dict:
    """Per-target WSTG coverage, derived from target_coverage via the mapping.

    Returns overall + per-chapter rollups and every test's derived status. `mapped` counts tests
    that have at least one taxonomy class behind them; catalog-only tests are reported but never
    counted as covered."""
    tests = db.query("SELECT id, chapter, num, title FROM wstg_tests ORDER BY chapter, num")
    maps = db.query("SELECT wstg_id, class_id FROM wstg_class_map")
    # Target's coverage status per class (default 'none').
    cov_rows = db.query("SELECT class_id, status, evidence_ids FROM target_coverage WHERE project_id=?",
                        [project_id])
    status_by_class = {r["class_id"]: r["status"] for r in cov_rows}
    evidence_by_class = {r["class_id"]: r["evidence_ids"] for r in cov_rows}
    classes_by_test: dict[str, list[str]] = {}
    for m in maps:
        classes_by_test.setdefault(m["wstg_id"], []).append(m["class_id"])

    test_rows = []
    chapters: dict[str, dict] = {}
    for t in tests:
        cids = classes_by_test.get(t["id"], [])
        mapped = bool(cids)
        rank = max((_RANK.get(status_by_class.get(cid, "none"), 0) for cid in cids), default=0)
        status = _BY_RANK[rank]
        covering = [cid for cid in cids if status_by_class.get(cid) == "covered"]
        evidence_ids = []
        for cid in covering:
            try:
                evidence_ids.extend(_json.loads(evidence_by_class.get(cid) or "[]") or [])
            except (ValueError, TypeError):
                pass
        test_rows.append({"id": t["id"], "chapter": t["chapter"], "num": t["num"], "title": t["title"],
                          "status": status, "mapped": mapped,
                          "class_ids": cids, "evidence_ids": sorted(set(evidence_ids))})
        ch = chapters.setdefault(t["chapter"], {"code": t["chapter"], "name": _CHAPTER_NAMES.get(t["chapter"], t["chapter"]),
                                                "total": 0, "mapped": 0, "covered": 0, "partial": 0})
        ch["total"] += 1
        if mapped:
            ch["mapped"] += 1
        if status == "covered":
            ch["covered"] += 1
        elif status == "partial":
            ch["partial"] += 1

    total = len(test_rows)
    covered = sum(1 for r in test_rows if r["status"] == "covered")
    partial = sum(1 for r in test_rows if r["status"] == "partial")
    mapped = sum(1 for r in test_rows if r["mapped"])
    return {
        "total": total, "mapped": mapped, "catalog_only": total - mapped,
        "covered": covered, "partial": partial,
        "chapters": [chapters[c] for c in sorted(chapters, key=_chapter_rank)],
        "tests": sorted(test_rows, key=lambda r: (_chapter_rank(r["chapter"]), r["num"])),
    }
