"""The engine/plugin layer — how tools feed the methodology spine.

An *engine* is any producer of evidence: a scanner (nuclei), a passive probe (fingerprint),
cve-intel, a GitLab bench, an AI provider. Each engine declares which taxonomy classes its
evidence can speak to, and when it produces a real finding we flip the matching class to
`covered` on that target with the finding row attached as evidence. The methodology, coverage
ledger and chain logic stay the product; engines plug in around the spine.

Design rules that keep this honest:
  * A class is only marked from a REAL finding id (evidence), never from a guess. A tag we do not
    map produces no coverage — we do not invent specificity we do not have.
  * Evidence is merged, never overwritten: two engines (or two findings) that touch the same class
    both keep their evidence ids.
  * Mapping is explicit and auditable (`list_engines()` shows exactly which classes each engine can
    reach), so the cockpit can show provenance instead of a magic number.
"""
from __future__ import annotations

import json

from .. import db
from . import taxonomy

# Nuclei tag (lowercase) -> (family_num, canonical class name in the taxonomy spine).
# Deliberately conservative: only tags with a defensible 1:1 class meaning are mapped. Broad tags
# like "misc"/"tech"/"misconfig" are intentionally absent — a vague tag should not flip a class.
_NUCLEI_TAG_MAP: dict[str, tuple[int, str]] = {
    "sqli": (10, "SQL injection"),
    "sql-injection": (10, "SQL injection"),
    "rce": (10, "Remote code execution"),
    "ssti": (10, "Server-Side Template Injection"),
    "lfi": (10, "File inclusion, local"),
    "rfi": (10, "File inclusion, remote"),
    "traversal": (10, "Path traversal, server-side"),
    "path-traversal": (10, "Path traversal, server-side"),
    "crlf": (10, "CRLF injection / HTTP response splitting"),
    "log4j": (10, "Log injection and log lookup evaluation"),
    "jndi": (10, "Log injection and log lookup evaluation"),
    "ssrf": (9, "Full-read SSRF"),
    "xxe": (11, "XXE file disclosure"),
    "deserialization": (11, "Java deserialization"),
    "xss": (16, "Reflected XSS, non-self"),
    "cors": (17, "CORS: reflected origin with credentials"),
    "redirect": (19, "Open redirect"),
    "open-redirect": (19, "Open redirect"),
    "ssrf-metadata": (9, "Cloud metadata access"),
    "jwt": (13, "JWT: alg:none or signature never verified"),
    "auth-bypass": (13, "Authentication bypass"),
    "default-login": (4, "Using default credentials"),
    "default-logins": (4, "Using default credentials"),
    "takeover": (4, "Subdomain takeover"),
    "graphql": (3, "GraphQL introspection in production"),
    "idor": (14, "IDOR / BOLA, iterable object identifiers, sensitive data"),
    "git": (1, "Exposed version control and environment files"),
    "config": (1, "Exposed version control and environment files"),
    "backup": (1, "Backup and temporary files"),
    "debug": (1, "Exposed debug and management endpoints"),
    "exposure": (1, "Exposed debug and management endpoints"),
    "logs": (1, "Exposed debug and management endpoints"),
    "secret": (1, "Disclosure of secrets for a publicly accessible asset"),
    "token": (1, "Disclosure of secrets for a publicly accessible asset"),
    "swagger": (1, "Exposed API schemas and introspection"),
    "api": (1, "Exposed API schemas and introspection"),
    "disclosure": (1, "Disclosure of secrets for a publicly accessible asset"),
}

# A CVE-bearing finding is, by definition, a known vulnerability in the running software.
_CVE_CLASS = (4, "Known vulnerabilities in edge software")


def _class_id_if_exists(family: int, name: str) -> str | None:
    cid = taxonomy.class_id(family, name)
    return cid if db.query_one("SELECT id FROM taxonomy_classes WHERE id=?", [cid]) else None


def classes_for_nuclei(finding: dict) -> list[str]:
    """Resolve a parsed nuclei finding to the taxonomy class ids its evidence speaks to.

    Pure: no DB writes. Uses the finding's tags and (if present) its CVE. Returns a de-duplicated
    list of class ids that actually exist in the spine. An unmapped finding returns []."""
    refs: list[tuple[int, str]] = []
    for tag in finding.get("tags") or []:
        hit = _NUCLEI_TAG_MAP.get(str(tag).strip().lower())
        if hit:
            refs.append(hit)
    if finding.get("cve"):
        refs.append(_CVE_CLASS)
    out: list[str] = []
    for family, name in refs:
        cid = _class_id_if_exists(family, name)
        if cid and cid not in out:
            out.append(cid)
    return out


def mark_covered(project_id: str, class_id: str, evidence_id: str, note: str) -> bool:
    """Flip a class to `covered` on a target, merging this evidence id with any already recorded.

    Idempotent: re-marking with the same evidence id is a no-op beyond refreshing the note. Returns
    True if the class existed and was marked, False if the class id is unknown."""
    row = db.query_one(
        "SELECT status, evidence_ids, note FROM target_coverage WHERE project_id=? AND class_id=?",
        [project_id, class_id])
    evidence: list[str] = []
    if row and row.get("evidence_ids"):
        try:
            evidence = json.loads(row["evidence_ids"]) or []
        except (ValueError, TypeError):
            evidence = []
    if evidence_id not in evidence:
        evidence.append(evidence_id)
    try:
        taxonomy.set_coverage(project_id, class_id, "covered", evidence_ids=evidence, note=note)
        return True
    except ValueError:
        return False


def apply_nuclei_finding(project_id: str, finding: dict, evidence_id: str) -> list[str]:
    """Auto-mark coverage from one real nuclei finding. Returns the class ids actually marked.

    `finding` is the dict from scanner.parse_nuclei_record; `evidence_id` is the stored
    vulnerabilities row id so coverage always points back to a real detection."""
    marked: list[str] = []
    note = f"nuclei:{finding.get('template_id', 'unknown')}"
    for class_id in classes_for_nuclei(finding):
        if mark_covered(project_id, class_id, evidence_id, note):
            marked.append(class_id)
    return marked


# ── Registry (provenance for the cockpit) ─────────────────────────────────────────

_ENGINES = [
    {
        "key": "nuclei",
        "name": "Nuclei",
        "kind": "scanner",
        "optional": False,
        "description": "Template-based vulnerability scanner. Each tagged/CVE finding marks its "
                       "taxonomy class covered with the finding attached as evidence.",
        "_tag_map": _NUCLEI_TAG_MAP,
        "_cve_class": _CVE_CLASS,
    },
]


def list_engines() -> list[dict]:
    """Every registered engine and the taxonomy classes it can reach, resolved to real class ids.

    This is the provenance layer the cockpit renders: for each engine, exactly which classes its
    evidence can flip, so coverage on the board is never an unexplained number."""
    out = []
    for eng in _ENGINES:
        refs = set(eng.get("_tag_map", {}).values())
        if eng.get("_cve_class"):
            refs.add(eng["_cve_class"])
        covers = []
        seen = set()
        for family, name in sorted(refs):
            cid = _class_id_if_exists(family, name)
            if cid and cid not in seen:
                seen.add(cid)
                covers.append({"class_id": cid, "family": family, "name": name})
        out.append({
            "key": eng["key"], "name": eng["name"], "kind": eng["kind"],
            "optional": eng["optional"], "description": eng["description"],
            "covers_count": len(covers), "covers": covers,
        })
    return out
