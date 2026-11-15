"""Technique extraction — turn a disclosed report into the reusable INVARIANT it teaches.

This is the "10 methodologies, not 10 scanners" half of the hacktivity research: given a
disclosure, name the *boundary* that failed (two components disagreeing about a request,
identity, object, or response) and map it to an authored methodology on the spine — so the feed
becomes a library of research leads, not a feed of other people's payloads.

Design principles (honour [[project_cyberbox_vision]]):
  * DETERMINISTIC first. A signal classifier reads the report TEXT, not just the coarse CWE bucket,
    so "Cross-account stored XSS -> admin takeover" (CWE-79) resolves to the *privilege-elevation*
    technique, not generic reflected XSS. No model is required. The optional LLM enrichment
    (hacktivity.enrich_disclosure) is a separate, additive polish — never a dependency.
  * OBSERVED != VERIFIED. Every technique card is stamped status='observed': a technique seen in a
    report is a hypothesis to test on your target, never a confirmed finding. This separation is the
    research's core discipline and the guard against false-positive bounty spam.
  * NON-GENERIC WINS. Novelty scoring rewards boundary-differential bugs over commodity XSS/IDOR,
    de-biasing the operator toward the leads that actually pay and don't dup.

Pure extraction (`extract`) does no DB writes; `extract_and_store` persists the ranked techniques;
`library` / `test_plan` / `match_project` read them back as a ranked, deduped technique library.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone

from .. import db
from . import engines, taxonomy

# ── Signal classifier ────────────────────────────────────────────────────────────
# Each signal maps report language -> an authored-methodology class. `pack` flags the 2026
# boundary-differential techniques (novelty boost). `cwe` corroborates. Patterns are regexes
# searched against the lowercased title+summary; weight 2.0 = distinctive, 1.0 = suggestive,
# 0.5 = weak. The class MUST exist in the spine (verified at load) and should carry a methodology
# so the card can emit its invariant + steps.

_P_STRONG, _P_MED, _P_WEAK = 2.0, 1.0, 0.5


def _sig(family, name, pack=False, cwe=(), strong=(), med=(), weak=()):
    pats = [(p, _P_STRONG) for p in strong] + [(p, _P_MED) for p in med] + [(p, _P_WEAK) for p in weak]
    return {"family": family, "name": name, "pack": pack, "cwe": {c.upper() for c in cwe},
            "patterns": [(re.compile(p), w) for p, w in pats]}


_SIGNALS = [
    # ── The 2026 boundary-differential pack ──────────────────────────────────────
    _sig(11, "Parser differentials", pack=True, cwe=("CWE-436",),
         strong=(r"pars(er|ing) differential", r"two parsers?", r"interpreted differently",
                 r"parsed? .{0,30}differently", r"\$id", r"\$ref"),
         med=(r"nested .{0,20}(schema|openapi)", r"duplicate (json )?key", r"content-?type confusion",
              r"schema (confusion|disagree|mismatch)", r"validation .{0,20}execution parser"),
         weak=(r"openapi", r"parser",)),
    _sig(10, "HTTP parameter pollution (HPP)", pack=True, cwe=("CWE-235", "CWE-88"),
         strong=(r"parameter pollution", r"\bhpp\b", r"request-?source precedence", r"precedence mismatch"),
         med=(r"duplicate parameter", r"same parameter .{0,30}(query|body)", r"two sources"),
         weak=(r"query .{0,20}body",)),
    _sig(14, "Broken Object Property Level Authorization", pack=True, cwe=("CWE-915", "CWE-213"),
         strong=(r"property[- ]level authorization", r"\bbopla\b", r"excessive data exposure"),
         med=(r"mass assignment", r"over-?post", r"field-?level (authorization|access)",
              r"returned .{0,25}(field|property) .{0,15}should"),
         weak=(r"extra field",)),
    _sig(14, "Header-based authorization bypass", pack=True,
         strong=(r"x-forwarded-\w+", r"x-original-url", r"x-rewrite-url", r"x-http-method-override"),
         med=(r"trusted header", r"header .{0,20}(auth|access) ?bypass", r"forwarded-for .{0,20}bypass"),
         weak=(r"header injection .{0,20}auth",)),
    _sig(12, "Inconsistent state across services", pack=True,
         strong=(r"inconsistent state", r"state confusion", r"validation-?to-?persistence",
                 r"validated .{0,30}persisted", r"persisted .{0,30}(instead|attacker|supplied)",
                 r"validated .{0,15}(slot|value|amount|time) .{0,30}(stored|persist|commit)"),
         med=(r"across services", r"two services", r"eventual consistency", r"sync .{0,20}between",
              r"validated .{0,10}(slot|value)", r"availability .{0,15}(check|validation)",
              r"arbitrary booking", r"persisted the"),
         weak=(r"state machine",)),
    _sig(12, "Workflow step skipping", pack=True,
         strong=(r"step[- ]skipping", r"skip(ping|ped)? .{0,15}step", r"workflow bypass"),
         med=(r"without completing", r"bypass .{0,20}(verification|payment) step", r"force.?d? .{0,15}step"),
         weak=(r"multi-?step",)),
    _sig(2, "Web cache deception", pack=True, cwe=("CWE-525",),
         strong=(r"cache deception", r"web cache deception"),
         med=(r"cached? .{0,20}(private|personal|session)", r"vary: ?cookie", r"cache-?control: ?public"),
         weak=(r"edge cache",)),
    _sig(14, "Suspended, deleted or unverified account still authorized", pack=True, cwe=("CWE-613",),
         strong=(r"after revocation", r"still authoriz", r"not invalidated", r"revoked .{0,20}still"),
         med=(r"removed collaborator", r"deleted .{0,15}still (access|work|authoriz)",
              r"session .{0,15}not .{0,10}invalidat", r"lifecycle"),
         weak=(r"revocation",)),
    _sig(12, "Time-of-check to time-of-use", pack=True, cwe=("CWE-367",),
         strong=(r"toctou", r"time-?of-?check", r"time-?of-?use"),
         med=(r"check .{0,15}use", r"race .{0,20}(balance|ownership|quota)"),
         weak=(r"race condition",)),
    _sig(6, "Cross-tenant PII leakage", pack=True, cwe=("CWE-200", "CWE-359"),
         strong=(r"cross-?tenant", r"another tenant", r"other (users?|tenants?)[\s']* data",
                 r"mass .{0,15}(information )?disclosure"),
         med=(r"pii .{0,15}(leak|expos)", r"author enumeration", r"(rss|archive|rest) .{0,20}expos",
              r"multi-?surface"),
         weak=(r"enumeration .{0,15}pii",)),
    _sig(16, "Mutation XSS (mXSS) and sanitizer bypass", pack=True, cwe=("CWE-79",),
         strong=(r"mutation xss", r"\bmxss\b", r"sanitizer bypass", r"dompurify bypass"),
         med=(r"re-?pars", r"namespace confusion", r"innerhtml .{0,20}mutat"),
         weak=(r"sanitiz",)),
    _sig(16, "Stored XSS, privileged user with privilege elevation", pack=True, cwe=("CWE-79",),
         strong=(r"administrator takeover", r"cross-?account .{0,20}xss", r"xss .{0,25}administrator",
                 r"stored xss .{0,25}admin"),
         med=(r"csp nonce", r"privileg\w+ .{0,15}xss", r"innerhtml .{0,20}admin")),
    _sig(2, "HTTP/2 downgrade smuggling", pack=True, cwe=("CWE-444",),
         strong=(r"http/?2 .{0,20}(smuggl|desync|downgrade)", r"request smuggling", r"\bdesync\b"),
         med=(r"downgrade", r"h2 .{0,15}smuggl", r"front-?end .{0,20}back-?end"),
         weak=(r"smuggling",)),
    _sig(10, "CSV / formula injection", pack=True, cwe=("CWE-1236",),
         strong=(r"csv injection", r"formula injection", r"spreadsheet .{0,15}(formula|inject)"),
         med=(r"\bdde\b", r"export .{0,15}inject", r"=cmd", r"webservice\(", r"hyperlink\("),
         weak=(r"spreadsheet",)),

    # ── The classic money-first set (lighter signatures) ─────────────────────────
    _sig(14, "IDOR / BOLA, iterable object identifiers, sensitive data", cwe=("CWE-639",),
         strong=(r"\bidor\b", r"\bbola\b", r"insecure direct object"),
         med=(r"object .{0,10}reference", r"iterable id", r"incrementing id")),
    _sig(14, "Broken Function Level Authorization (BFLA)",
         strong=(r"\bbfla\b", r"function[- ]level authorization"),
         med=(r"privileged (action|endpoint|function)", r"admin (endpoint|function) .{0,20}low")),
    _sig(14, "Cross-tenant escalation",
         strong=(r"cross-?tenant .{0,15}escalat",), med=(r"tenant .{0,15}escalat",)),
    _sig(9, "Full-read SSRF", cwe=("CWE-918",),
         strong=(r"\bssrf\b", r"server-?side request forgery"),
         med=(r"fetch .{0,15}internal", r"import by url")),
    _sig(9, "Cloud metadata access", cwe=("CWE-918",),
         strong=(r"169\.254\.169\.254", r"\bimds\b", r"instance metadata"),
         med=(r"metadata endpoint", r"metadata service")),
    _sig(9, "Blind SSRF", strong=(r"blind ssrf",), med=(r"oob .{0,10}ssrf", r"dns .{0,10}ssrf")),
    _sig(10, "SQL injection", cwe=("CWE-89",),
         strong=(r"sql injection", r"\bsqli\b"), med=(r"union select", r"blind sql")),
    _sig(10, "Server-Side Template Injection", cwe=("CWE-1336",),
         strong=(r"template injection", r"\bssti\b"), med=(r"jinja", r"freemarker", r"\bognl\b")),
    _sig(10, "OS command injection", cwe=("CWE-78",),
         strong=(r"command injection", r"os command"), med=(r"rce .{0,15}command",)),
    _sig(13, "Authentication bypass",
         strong=(r"authentication bypass", r"auth(entication)? bypass"), med=(r"login bypass",)),
    _sig(13, "OTP / 2FA brute force",
         strong=(r"otp .{0,15}brute", r"2fa bypass", r"mfa bypass"), med=(r"otp not bound",)),
    _sig(13, "Predictable password reset token",
         strong=(r"password reset token", r"reset token .{0,15}predict"), med=(r"predictable .{0,10}token",)),
    _sig(5, "Weak redirect_uri validation",
         strong=(r"redirect_uri", r"oauth .{0,15}redirect"), med=(r"open redirect .{0,15}oauth",)),
    _sig(12, "Race condition on a limit (limit overrun)",
         strong=(r"limit overrun", r"race .{0,15}limit"), med=(r"coupon .{0,15}race", r"concurrent request")),
    _sig(12, "Payment bypass",
         strong=(r"payment bypass", r"price manipulat"), med=(r"amount tamper", r"negative (price|amount)")),
    _sig(15, "Unrestricted upload to RCE",
         strong=(r"upload .{0,15}rce", r"upload .{0,15}shell"), med=(r"unrestricted .{0,10}upload",)),
    _sig(11, "Java deserialization", cwe=("CWE-502",),
         strong=(r"deserializ", r"insecure deserialization"), med=(r"gadget chain", r"ysoserial")),
    _sig(16, "Reflected XSS, non-self", cwe=("CWE-79",),
         strong=(r"reflected xss",), med=(r"reflected .{0,15}without encoding", r"reflected .{0,12}parameter")),
    _sig(16, "Stored XSS, non-privileged user to anyone", cwe=("CWE-79",),
         strong=(r"stored xss",), med=(r"persistent xss", r"stored .{0,10}script")),
    _sig(16, "DOM-based XSS", cwe=("CWE-79",),
         strong=(r"dom-?based xss", r"dom xss"), med=(r"source .{0,10}sink", r"location\.hash")),
    _sig(6, "Prompt injection, indirect",
         strong=(r"prompt injection", r"indirect prompt"), med=(r"llm .{0,10}inject", r"jailbreak")),
    _sig(7, "Dependency confusion",
         strong=(r"dependency confusion",), med=(r"package .{0,10}confusion", r"internal .{0,10}package")),
]

# Resolve each signal's class id once (pure slug — no DB at import time). Existence in the spine is
# enforced at classification time in extract(), so a class renamed out of the taxonomy drops its
# signal instead of persisting a dangling FK.
_RESOLVED: list[dict] = []
for _s in _SIGNALS:
    _cid = taxonomy.class_id(_s["family"], _s["name"])
    _s["class_id"] = _cid
    _RESOLVED.append(_s)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _novelty(disclosure: dict, top: dict | None, pack_hits: int) -> int:
    """0-100. Rewards the non-generic: boundary-differentials, high-tail payouts, chains. A
    commodity XSS/IDOR scores modestly even when it paid; a parser differential scores high."""
    score = 30.0
    if top and top.get("pack"):
        score += 35
    if pack_hits >= 2:          # a chain of two boundary disagreements — the strongest leads
        score += 8
    amt = disclosure.get("bounty_amount") or 0
    if amt >= 10000:
        score += 20
    elif amt >= 3000:
        score += 12
    elif amt >= 1000:
        score += 6
    sev = (disclosure.get("severity") or "").lower()
    score += {"critical": 10, "high": 6, "medium": 2}.get(sev, 0)
    return max(0, min(100, round(score)))


def _confidence(pattern_score: float, cwe_hit: bool, fallback: bool) -> str:
    if fallback:
        return "low"
    if pattern_score >= _P_STRONG or (pattern_score >= _P_MED and cwe_hit):
        return "high"
    if pattern_score >= _P_MED or (pattern_score >= _P_WEAK and cwe_hit):
        return "medium"
    return "low"


def extract(disclosure: dict) -> dict:
    """Pure: classify one disclosure into the reusable technique(s) it teaches. No DB writes.

    Returns a technique card: the ranked techniques (each with the invariant it teaches, the
    authored hunt steps, a confidence and the exact signals that fired), a novelty score, and the
    status='observed' stamp. Falls back to the coarse CWE map when no language signal fires."""
    text = f"{disclosure.get('title') or ''}\n{disclosure.get('summary') or ''}".lower()
    cwe = (disclosure.get("cwe") or "").upper()

    scored = []
    pack_hits = 0
    for s in _RESOLVED:
        hits, score = [], 0.0
        for pat, w in s["patterns"]:
            if pat.search(text):
                hits.append(pat.pattern)
                score += w
        # CWE corroborates text; it never triggers a signal on its own (a bare CWE-79 with no
        # boundary language must NOT become mXSS — it falls through to the coarse-CWE canonical class).
        cwe_hit = bool(cwe and cwe in s["cwe"] and hits)
        if cwe_hit:
            score += 1.0
        if score <= 0:
            continue
        if s["pack"]:
            pack_hits += 1
        scored.append({
            "class_id": s["class_id"], "class_name": s["name"], "family_num": s["family"],
            "pack": s["pack"], "_score": round(score, 2), "cwe_hit": cwe_hit,
            "signals": hits, "confidence": _confidence(score - (1.0 if cwe_hit else 0.0), cwe_hit, False),
        })
    scored.sort(key=lambda t: (t["_score"], t["pack"]), reverse=True)
    # Dedup by class: if two signals ever resolve to the same class, keep the higher-scored one, so
    # the persisted rows never collide on UNIQUE(disclosure_id, class_id). (Signals are distinct today;
    # this guards the hand-maintained list against future drift.)
    seen: set[str] = set()
    scored = [t for t in scored if not (t["class_id"] in seen or seen.add(t["class_id"]))]
    # FK-safe: drop any signal whose class was renamed out of the spine, so we never persist a
    # dangling class_id (which would raise IntegrityError under foreign_keys=ON). Cheap single query.
    if scored:
        ids = [t["class_id"] for t in scored]
        placeholders = ",".join("?" * len(ids))
        live = {r["id"] for r in db.query(
            f"SELECT id FROM taxonomy_classes WHERE id IN ({placeholders})", ids)}
        scored = [t for t in scored if t["class_id"] in live]

    fallback = False
    if not scored:
        # No language signal — lean on the coarse CWE bucket so every mapped report still yields a lead.
        cid, fam = engines.class_for_cwe(cwe) if cwe else (None, None)
        if cid:
            cls = db.query_one("SELECT name FROM taxonomy_classes WHERE id=?", [cid])
            scored = [{"class_id": cid, "class_name": cls["name"] if cls else cid, "family_num": fam,
                       "pack": False, "_score": 0.0, "cwe_hit": True, "signals": ["cwe-fallback"],
                       "confidence": "low"}]
            fallback = True

    top = scored[0] if scored else None
    novelty = _novelty(disclosure, top, pack_hits)

    techniques = []
    for rank, t in enumerate(scored[:3], start=1):
        meth = taxonomy.methodology(t["class_id"]) if t["class_id"] else {}
        techniques.append({
            "rank": rank, "class_id": t["class_id"], "class_name": t["class_name"],
            "family_num": t["family_num"], "is_boundary": t["pack"],
            "confidence": t["confidence"], "signals": t["signals"], "cwe_hit": t["cwe_hit"],
            "invariant": meth.get("boundary"),
            "hunt_steps": meth.get("steps") or [],
            "ai_hook": meth.get("ai_hook"),
            "has_methodology": bool(meth.get("has_methodology")),
        })

    return {
        "disclosure_id": disclosure.get("id"),
        "title": disclosure.get("title"),
        "url": disclosure.get("url"),
        "program": disclosure.get("program_name") or disclosure.get("program_handle"),
        "bounty_amount": disclosure.get("bounty_amount"),
        "severity": disclosure.get("severity"),
        "status": "observed",   # a technique seen in a report is a hypothesis, never a verified finding
        "novelty": novelty,
        "is_boundary": bool(top and top["pack"]),
        "primary": techniques[0] if techniques else None,
        "techniques": techniques,
        "fallback": fallback,
    }


def extract_and_store(disclosure_id: str) -> dict:
    """Extract one disclosure and persist its ranked techniques (dedup on disclosure+class).
    Idempotent — re-running refreshes scores. Returns the card.

    A disclosure that classifies to zero techniques still gets a sentinel row (class_id NULL) so it
    is marked processed and never reprocessed on the next ingest. library()/match_project ignore the
    sentinel (they filter class_id IS NOT NULL)."""
    d = db.query_one("SELECT * FROM disclosures WHERE id=?", [disclosure_id])
    if not d:
        return {"status": "not-found"}
    card = extract(db.decode_row(d))
    now = _now()
    with db.batch():
        db.execute("DELETE FROM disclosure_techniques WHERE disclosure_id=?", [disclosure_id])
        for t in card["techniques"]:
            db.insert("disclosure_techniques", {
                "id": str(uuid.uuid4()), "disclosure_id": disclosure_id, "class_id": t["class_id"],
                "rank": t["rank"], "is_boundary": 1 if t["is_boundary"] else 0,
                "confidence": t["confidence"], "novelty": card["novelty"],
                "signals": json.dumps(t["signals"]), "status": "observed", "extracted_at": now})
        if not card["techniques"]:
            db.insert("disclosure_techniques", {
                "id": str(uuid.uuid4()), "disclosure_id": disclosure_id, "class_id": None,
                "rank": 0, "is_boundary": 0, "confidence": "low", "novelty": card["novelty"],
                "signals": "[]", "status": "observed", "extracted_at": now})
    return card


def card(disclosure_id: str) -> dict:
    """Read-only technique card for one disclosure. Classifies on first request (no stored rows), then
    serves the persisted classification on every subsequent call — a GET must not rewrite the DB."""
    d = db.query_one("SELECT * FROM disclosures WHERE id=?", [disclosure_id])
    if not d:
        return {"status": "not-found"}
    rows = db.query(
        "SELECT * FROM disclosure_techniques WHERE disclosure_id=? ORDER BY rank", [disclosure_id])
    if not rows:                       # never classified → extract once and persist
        return extract_and_store(disclosure_id)
    d = db.decode_row(d)
    techniques = []
    for r in rows:
        if not r["class_id"]:          # sentinel marker → no technique, skip
            continue
        meth = taxonomy.methodology(r["class_id"])
        techniques.append({
            "rank": r["rank"], "class_id": r["class_id"], "class_name": meth.get("class_name"),
            "family_num": meth.get("family_num"), "is_boundary": bool(r["is_boundary"]),
            "confidence": r["confidence"], "signals": json.loads(r["signals"] or "[]"),
            "invariant": meth.get("boundary"), "hunt_steps": meth.get("steps") or [],
            "ai_hook": meth.get("ai_hook"), "has_methodology": bool(meth.get("has_methodology"))})
    return {
        "disclosure_id": disclosure_id, "title": d.get("title"), "url": d.get("url"),
        "program": d.get("program_name") or d.get("program_handle"),
        "bounty_amount": d.get("bounty_amount"), "severity": d.get("severity"),
        "status": "observed", "novelty": rows[0]["novelty"],
        "is_boundary": bool(techniques and techniques[0]["is_boundary"]),
        "primary": techniques[0] if techniques else None, "techniques": techniques}


def extract_all(limit: int = 1000, reextract: bool = False) -> dict:
    """Batch-extract disclosures into the technique store. By default skips disclosures already
    extracted; reextract=True refreshes them all (use after the signal map changes)."""
    if reextract:
        rows = db.query("SELECT id FROM disclosures ORDER BY ingested_at DESC LIMIT ?", [limit])
    else:
        rows = db.query(
            "SELECT d.id FROM disclosures d LEFT JOIN disclosure_techniques t ON t.disclosure_id=d.id "
            "WHERE t.id IS NULL ORDER BY d.ingested_at DESC LIMIT ?", [limit])
    processed = written = 0
    for r in rows:
        card = extract_and_store(r["id"])
        if card.get("techniques"):
            written += len(card["techniques"])
        processed += 1
    return {"processed": processed, "techniques_written": written}


def library(boundary_only: bool = False, min_confidence: str | None = None,
            limit: int = 100) -> list[dict]:
    """The deduped technique library: one row per taxonomy class taught by >=1 disclosure, ranked by
    a composite of novelty x payout x recency x volume. This is the research's 'collection of leads,'
    not a feed of payloads — each row carries the invariant, the authored hunt steps, and the example
    reports that teach it."""
    conf_floor = {"low": 0, "medium": 1, "high": 2}
    raw = (min_confidence or "low").lower()
    if raw not in conf_floor:
        raise ValueError("min_confidence must be one of: low, medium, high")
    floor = conf_floor[raw]
    rows = db.query(
        "SELECT t.class_id, t.is_boundary, t.confidence, t.novelty, t.rank, "
        "       d.id AS did, d.title, d.url, d.program_name, d.program_handle, d.bounty_amount, "
        "       d.severity, d.disclosed_at "
        "FROM disclosure_techniques t JOIN disclosures d ON d.id=t.disclosure_id "
        "WHERE t.class_id IS NOT NULL")
    groups: dict[str, dict] = {}
    for r in rows:
        if floor and conf_floor.get(r["confidence"], 0) < floor:
            continue
        if boundary_only and not r["is_boundary"]:
            continue
        g = groups.setdefault(r["class_id"], {
            "class_id": r["class_id"], "is_boundary": bool(r["is_boundary"]),
            "report_count": 0, "programs": set(), "bounties": [], "novelties": [],
            "latest": None, "examples": [], "_conf": 0})
        g["report_count"] += 1
        g["_conf"] = max(g["_conf"], conf_floor.get(r["confidence"], 0))  # best-match confidence seen
        g["is_boundary"] = g["is_boundary"] or bool(r["is_boundary"])
        prog = r["program_name"] or r["program_handle"]
        if prog:
            g["programs"].add(prog)
        if r["bounty_amount"]:
            g["bounties"].append(r["bounty_amount"])
        g["novelties"].append(r["novelty"] or 0)
        if r["disclosed_at"] and (g["latest"] is None or r["disclosed_at"] > g["latest"]):
            g["latest"] = r["disclosed_at"]
        # keep up to 4 strongest example reports (prefer rank 1 + paid)
        g["examples"].append({"id": r["did"], "title": r["title"], "url": r["url"],
                              "program": prog, "bounty": r["bounty_amount"], "rank": r["rank"],
                              "severity": r["severity"]})

    out = []
    for g in groups.values():
        cls = db.query_one("SELECT name, family_num, priority, payout_rank FROM taxonomy_classes WHERE id=?",
                           [g["class_id"]])
        meth = taxonomy.methodology(g["class_id"])
        bounties = sorted(g.pop("bounties"))
        novelties = g.pop("novelties")
        g["class_name"] = cls["name"] if cls else g["class_id"]
        g["family_num"] = cls["family_num"] if cls else None
        g["priority"] = cls["priority"] if cls else None
        g["program_count"] = len(g.pop("programs"))
        g["max_bounty"] = bounties[-1] if bounties else None
        g["median_bounty"] = bounties[len(bounties) // 2] if bounties else None
        g["avg_novelty"] = round(sum(novelties) / len(novelties)) if novelties else 0
        g["confidence"] = {0: "low", 1: "medium", 2: "high"}[g.pop("_conf")]
        g["invariant"] = meth.get("boundary")
        g["hunt_steps"] = meth.get("steps") or []
        g["ai_hook"] = meth.get("ai_hook")
        g["has_methodology"] = bool(meth.get("has_methodology"))
        g["examples"] = sorted(g["examples"], key=lambda e: (e["rank"], -(e["bounty"] or 0)))[:4]
        # composite rank: novelty-weighted, payout tail, recency-light, volume-light
        pay = (g["max_bounty"] or 0)
        g["lead_score"] = round(g["avg_novelty"] * 1.0 + (pay ** 0.5) * 0.5 + g["report_count"] * 2)
        out.append(g)
    out.sort(key=lambda g: (g["lead_score"], g["is_boundary"]), reverse=True)
    return out[:limit]


def test_plan(class_id: str) -> dict:
    """A copy-ready test plan for one taught technique: the invariant, the authored steps, the
    example disclosures to study, the standalone/chain reportability gate, and the loud reminder
    that this is a technique to TRY, not a finding to report."""
    meth = taxonomy.methodology(class_id)   # raises ValueError on unknown class
    report = taxonomy.reportability(class_id)
    examples = db.query(
        "SELECT d.id, d.title, d.url, d.program_name, d.bounty_amount, d.severity "
        "FROM disclosure_techniques t JOIN disclosures d ON d.id=t.disclosure_id "
        "WHERE t.class_id=? ORDER BY t.rank, d.bounty_amount DESC LIMIT 6", [class_id])
    return {
        "class_id": class_id,
        "class_name": meth.get("class_name"),
        "family_num": meth.get("family_num"),
        "invariant": meth.get("boundary"),
        "status": "observed",
        "disclaimer": ("Technique observed in disclosed reports — a hypothesis to test on your "
                       "target, NOT a confirmed vulnerability. Prove the boundary on your own "
                       "scope before it is a finding."),
        "steps": meth.get("steps") or [],
        "ai_hook": meth.get("ai_hook"),
        "has_methodology": bool(meth.get("has_methodology")),
        "reportability": report,
        "example_reports": [db.decode_row(e) for e in examples],
    }


def match_project(project_id: str, limit: int = 40) -> list[dict]:
    """Overlay the technique library onto a target's coverage: the taught techniques whose class is
    still UNCOVERED on this project — 'hunt this here next', ranked by lead score, with the reason
    (uncovered + the $ and novelty the market shows). Covered classes are dropped (already worked)."""
    covered = {r["class_id"] for r in db.query(
        "SELECT class_id FROM target_coverage WHERE project_id=? AND status='covered'", [project_id])}
    partial = {r["class_id"] for r in db.query(
        "SELECT class_id FROM target_coverage WHERE project_id=? AND status='partial'", [project_id])}
    out = []
    for lead in library(limit=200):
        if lead["class_id"] in covered:
            continue
        lead["coverage"] = "partial" if lead["class_id"] in partial else "none"
        lead["reason"] = (
            f"{'Partially worked' if lead['coverage'] == 'partial' else 'Not yet worked'} on this target; "
            f"{lead['report_count']} disclosed report(s)"
            + (f", up to {int(lead['max_bounty'])} paid" if lead.get("max_bounty") else "")
            + (", boundary-differential (non-generic)" if lead["is_boundary"] else "") + ".")
        out.append(lead)
        if len(out) >= limit:
            break
    return out
