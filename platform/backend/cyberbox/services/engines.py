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
import uuid
from datetime import datetime, timezone

from .. import db
from . import taxonomy


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

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


# ── Fingerprint engine (passive probe → coverage) ─────────────────────────────────
#
# A fingerprint is passive recon, not a scan — so it may only mark a class when the probe
# *directly observed* the condition, where the observation itself IS the finding. We never flip
# a class from an absence, a version guess, or a "normal but noisy" signal (REST enabled, public
# projects). Each rule below carries the concrete evidence into the stored row so coverage always
# points back to something real a human can re-check. Deliberately short: three defensible rules
# beat ten that cry wolf. `fp:*` dedup keys mean re-probing the same target reuses one evidence row.

def _fp_wordpress_observations(result: dict) -> list[dict]:
    """Confirmed, self-evident findings from a WordPress fingerprint. Pure."""
    obs: list[dict] = []
    users = result.get("users") or []
    if (result.get("exposed") or {}).get("rest_users") and users:
        slugs = ", ".join(str(u.get("slug") or u.get("name") or u.get("id")) for u in users[:10])
        obs.append({
            "code": "wp-user-enum", "family": 13, "class_name": "Username / email enumeration",
            "name": "WordPress username enumeration via REST API",
            "severity": "low", "category": "Information Disclosure",
            "description": f"/wp-json/wp/v2/users returned {len(users)} account(s) unauthenticated: {slugs}.",
        })
    vuln_plugins = [p for p in (result.get("plugins") or []) if p.get("known_advisories")]
    if vuln_plugins:
        names = ", ".join(f"{p.get('slug')}@{p.get('version') or '?'}" for p in vuln_plugins[:8])
        obs.append({
            "code": "wp-vuln-plugin", "family": 4, "class_name": "Known vulnerabilities in edge software",
            "name": "WordPress plugin at a version with a published advisory",
            "severity": "medium", "category": "Vulnerable Component",
            "description": f"{len(vuln_plugins)} detected plugin(s) match a known advisory at the fingerprinted version: {names}.",
        })
    return obs


def _fp_gitlab_observations(result: dict) -> list[dict]:
    """Confirmed, self-evident findings from a GitLab fingerprint. Pure."""
    obs: list[dict] = []
    if result.get("version") and (result.get("exposed") or {}).get("public_api"):
        rev = f" (rev {result['revision']})" if result.get("revision") else ""
        obs.append({
            "code": "gl-version-disclosure", "family": 1,
            "class_name": "Fingerprinting / banner disclosure, software versions in headers",
            "name": "GitLab version disclosed via unauthenticated /api/v4/version",
            "severity": "info", "category": "Information Disclosure",
            "description": f"Unauthenticated /api/v4/version exposed GitLab {result['version']}{rev} — pins the instance to published CVEs.",
        })
    return obs


_FP_RESOLVERS = {"wordpress": _fp_wordpress_observations, "gitlab": _fp_gitlab_observations}


def classes_for_fingerprint(kind: str, result: dict) -> list[dict]:
    """Resolve a fingerprint result to confirmed observations + their taxonomy class ids. Pure.

    Returns a list of observation dicts (each with a real `class_id`) for the UI/engine; an
    unmapped or empty result returns []. Observations whose class is not in the spine are dropped."""
    out: list[dict] = []
    for obs in _FP_RESOLVERS.get(kind, lambda _r: [])(result):
        cid = _class_id_if_exists(obs["family"], obs["class_name"])
        if cid:
            out.append({**obs, "class_id": cid})
    return out


def apply_fingerprint_finding(project_id: str, kind: str, result: dict, target: str) -> list[str]:
    """Persist a passive-probe observation as evidence and auto-mark its taxonomy class covered.

    Each observation becomes one `vulnerabilities` row (deduped per target so a re-probe reuses it),
    then flips its class to `covered` with that row as evidence — the same honesty contract as the
    nuclei path. Returns the class ids actually marked. Caller should guard; never fails the probe."""
    marked: list[str] = []
    host = (target or result.get("target") or "").strip()
    for obs in classes_for_fingerprint(kind, result):
        dedup_key = f"fp:{obs['code']}:{host}"
        existing = db.query_one(
            "SELECT id FROM vulnerabilities WHERE project_id=? AND dedup_key=?", [project_id, dedup_key])
        if existing:
            evidence_id = existing["id"]
        else:
            evidence_id = str(uuid.uuid4())
            db.insert("vulnerabilities", {
                "id": evidence_id, "project_id": project_id, "asset_id": None,
                "template_id": f"fingerprint-{obs['code']}", "name": obs["name"],
                "severity": obs["severity"], "category": obs["category"],
                "description": obs["description"], "cve": None, "host": host,
                "matched_at": host, "status": "open", "verified": 1, "poc": "",
                "request_chain": "[]", "tags": json.dumps(["fingerprint", kind, obs["code"]]),
                "dedup_key": dedup_key, "sla_due": None, "detected_at": _now(), "fixed_at": None,
            })
        if mark_covered(project_id, obs["class_id"], evidence_id, f"fingerprint:{kind}:{obs['code']}"):
            marked.append(obs["class_id"])
    return marked


# ── CVE-intel engine (NVD sweep → coverage) ───────────────────────────────────────
#
# A CVE sweep matches published NVD CVEs to a detected tech stack. A real match is, by the same
# definition the nuclei path uses, a "Known vulnerabilities in edge software" finding — so a hit
# with a real CVE id flips that one class. One class only: an NVD keyword match proves a known-vuln
# *candidate* on the stack, not any specific injection/auth class, so we never fan it out. The hit
# is persisted as its own deduped vulnerabilities row (like the fingerprint engine) so coverage
# always points at a real stored finding, independent of any other store.

def apply_cve_hit(project_id: str, hit: dict) -> list[str]:
    """Persist one real CVE-sweep hit as evidence and auto-mark the known-vuln class.

    `hit` is a dict with at least `cve_id` (optionally tech/severity/cvss_score/description).
    Deduped per (cve, project) so a re-sweep reuses one row. Returns the class ids marked."""
    cve_id = (hit.get("cve_id") or "").strip()
    if not cve_id:
        return []  # no CVE id = no defensible known-vuln claim
    cid = _class_id_if_exists(*_CVE_CLASS)
    if not cid:
        return []
    tech = (hit.get("tech") or "").strip()
    sev = str(hit.get("severity") or "medium").lower()
    sev = sev if sev in {"critical", "high", "medium", "low", "info"} else "medium"
    dedup_key = f"cve-intel:{cve_id}"
    existing = db.query_one(
        "SELECT id FROM vulnerabilities WHERE project_id=? AND dedup_key=?", [project_id, dedup_key])
    if existing:
        evidence_id = existing["id"]
    else:
        evidence_id = str(uuid.uuid4())
        score = hit.get("cvss_score")
        desc = (hit.get("description") or
                f"NVD lists {cve_id} affecting {tech or 'the detected stack'}"
                f"{f' (CVSS {score})' if score is not None else ''}.")
        db.insert("vulnerabilities", {
            "id": evidence_id, "project_id": project_id, "asset_id": None,
            "template_id": f"cve-intel-{cve_id}", "name": f"{cve_id} in {tech or 'detected software'}",
            "severity": sev, "category": "Vulnerable Component", "description": desc[:800],
            "cve": cve_id, "host": tech, "matched_at": tech, "status": "open", "verified": 0,
            "poc": "", "request_chain": "[]", "tags": json.dumps(["cve-intel", "cve"]),
            "dedup_key": dedup_key, "sla_due": None, "detected_at": _now(), "fixed_at": None,
        })
    if mark_covered(project_id, cid, evidence_id, f"cve-intel:{cve_id}"):
        return [cid]
    return []


# ── vulnx engine (ProjectDiscovery vulnerability.sh → coverage) ────────────────────
#
# A vulnx hit is a published CVE enriched with tags/CWE + KEV/EPSS/template flags. Because it
# carries tags, it can flip a *specific* class (ssrf → f9, sqli → f10) via the same conservative
# tag map the nuclei path uses — not just the generic known-vuln class. It always also marks f4
# (it is, after all, a known vuln in edge software). KEV/EPSS/template ride along on the stored
# evidence row as prioritisation signal. Egresses to vulnerability.sh, so unlike NVD it round-trips
# here; still conservative — an untagged hit marks only f4, never an invented specific class.

# CWE → taxonomy class, for the few CWEs with a crisp 1:1 meaning (augments tag mapping).
_CWE_CLASS_MAP: dict[str, tuple[int, str]] = {
    "CWE-918": (9, "Full-read SSRF"),
    "CWE-89": (10, "SQL injection"),
    "CWE-79": (16, "Reflected XSS, non-self"),
    "CWE-78": (10, "OS command injection"),
    "CWE-22": (10, "Path traversal, server-side"),
    "CWE-611": (11, "XXE file disclosure"),
    "CWE-502": (11, "Java deserialization"),
    "CWE-94": (10, "Remote code execution"),
    "CWE-98": (10, "File inclusion, remote"),
    "CWE-1336": (10, "Server-Side Template Injection"),
}


def classes_for_vulnx(hit: dict) -> list[str]:
    """Resolve a vulnx hit to taxonomy class ids via its tags + CWE, plus f4. Pure. De-duped."""
    refs: list[tuple[int, str]] = []
    for tag in hit.get("tags") or []:
        found = _NUCLEI_TAG_MAP.get(str(tag).strip().lower())
        if found:
            refs.append(found)
    for cwe in hit.get("cwe") or []:
        found = _CWE_CLASS_MAP.get(str(cwe).strip().upper())
        if found:
            refs.append(found)
    if hit.get("cve_id"):
        refs.append(_CVE_CLASS)
    out: list[str] = []
    for family, name in refs:
        cid = _class_id_if_exists(family, name)
        if cid and cid not in out:
            out.append(cid)
    return out


def apply_vulnx_hit(project_id: str, hit: dict) -> list[str]:
    """Persist one vulnx hit as evidence and mark every class it speaks to. Deduped per (cve,project)."""
    cve_id = (hit.get("cve_id") or "").strip()
    if not cve_id:
        return []
    class_ids = classes_for_vulnx(hit)
    if not class_ids:
        return []
    dedup_key = f"vulnx:{cve_id}"
    existing = db.query_one(
        "SELECT id FROM vulnerabilities WHERE project_id=? AND dedup_key=?", [project_id, dedup_key])
    if existing:
        evidence_id = existing["id"]
    else:
        evidence_id = str(uuid.uuid4())
        sev = str(hit.get("severity") or "medium").lower()
        sev = sev if sev in {"critical", "high", "medium", "low", "info"} else "medium"
        flags = []
        if hit.get("is_kev"):
            flags.append("KEV")
        if hit.get("epss_score") is not None:
            flags.append(f"EPSS {hit['epss_score']:.3f}")
        if hit.get("is_template"):
            flags.append("nuclei-template")
        tech = (hit.get("tech") or "").strip()
        base = hit.get("description") or f"vulnerability.sh lists {cve_id} affecting {tech or 'the detected stack'}."
        desc = (base[:700] + (f"  [{', '.join(flags)}]" if flags else "")).strip()
        db.insert("vulnerabilities", {
            "id": evidence_id, "project_id": project_id, "asset_id": None,
            "template_id": f"vulnx-{cve_id}", "name": f"{cve_id} in {tech or 'detected software'}",
            "severity": sev, "category": "Vulnerable Component", "description": desc,
            "cve": cve_id, "host": tech, "matched_at": tech,
            # KEV = publicly, actively exploited → treat as verified; otherwise a candidate.
            "status": "open", "verified": 1 if hit.get("is_kev") else 0, "poc": "",
            "request_chain": "[]",
            "tags": json.dumps(["vulnx"] + [t for t in (hit.get("tags") or []) if t][:10]),
            "dedup_key": dedup_key, "sla_due": None, "detected_at": _now(), "fixed_at": None,
        })
    marked = []
    for cid in class_ids:
        if mark_covered(project_id, cid, evidence_id, f"vulnx:{cve_id}"):
            marked.append(cid)
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
    {
        "key": "fingerprint",
        "name": "Fingerprint",
        "kind": "passive-probe",
        "optional": False,
        "description": "Passive, unauthenticated WordPress/GitLab probe. A directly-observed "
                       "condition (user enumeration, a plugin at a known-vulnerable version, an "
                       "unauthenticated version banner) marks its class covered with the "
                       "observation stored as evidence. Never flips a class from a guess.",
        "_static_classes": [
            (13, "Username / email enumeration"),
            (4, "Known vulnerabilities in edge software"),
            (1, "Fingerprinting / banner disclosure, software versions in headers"),
        ],
    },
    {
        "key": "cve-intel",
        "name": "CVE Intel",
        "kind": "intel",
        "optional": False,
        "description": "NVD CVE sweep against the detected tech stack. A real CVE match marks "
                       "'Known vulnerabilities in edge software' covered with the stored hit as "
                       "evidence — a known-vuln candidate on the stack, not a specific exploit class.",
        "_static_classes": [_CVE_CLASS],
    },
    {
        "key": "vulnx",
        "name": "vulnx",
        "kind": "intel",
        "optional": False,
        "description": "ProjectDiscovery vulnerability.sh intel. CVEs affecting the detected product, "
                       "enriched with tags/CWE (so a hit flips the specific class, e.g. SSRF/SQLi) and "
                       "KEV/EPSS/nuclei-template flags for prioritisation. Marks every class a hit's "
                       "tags+CWE speak to, plus the known-vuln class.",
        # Everything vulnx can reach: the nuclei tag map + the CWE map + the known-vuln class.
        "_static_classes": [_CVE_CLASS, *_NUCLEI_TAG_MAP.values(), *_CWE_CLASS_MAP.values()],
    },
]


def list_engines() -> list[dict]:
    """Every registered engine and the taxonomy classes it can reach, resolved to real class ids.

    This is the provenance layer the cockpit renders: for each engine, exactly which classes its
    evidence can flip, so coverage on the board is never an unexplained number."""
    out = []
    for eng in _ENGINES:
        refs = set(eng.get("_tag_map", {}).values())
        refs.update(eng.get("_static_classes", []))
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
