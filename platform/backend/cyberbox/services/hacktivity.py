"""Disclosed-report intel — HackerOne hacktivity ingested onto the taxonomy spine.

A market-wide feed of what's being found and paid. Primary source is a JSONL artifact committed
by the hacktivity-bot GitHub Action (which survives Cloudflare because it runs from Actions);
fetch_live() is the sandbox/cf-bypass fallback that queries H1 directly. Each disclosure is mapped
to a taxonomy class by CWE, so the feed market-validates the methodology spine (real $ per class),
and the enrichment pass (enrich.py) turns each into reusable hunt methodology.

No project scope needed — this is passive, public intel (the vulnx tier). No user-private data is
ever sent in the live query.
"""
from __future__ import annotations

import json
import urllib.request
import uuid
from datetime import datetime, timezone

from .. import db
from . import engines
from . import model as model_svc

_H1_GRAPHQL = "https://hackerone.com/graphql"
_RAW_GITHUB = "https://raw.githubusercontent.com"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _report_id(node: dict, report: dict, url: str) -> str:
    """Stable H1 report id — databaseId/_id if present, else parsed from /reports/<id>."""
    rid = report.get("databaseId") or report.get("_id") or node.get("_id") or node.get("id")
    if rid:
        return str(rid)
    if url and "/reports/" in url:
        return url.rstrip("/").rsplit("/reports/", 1)[-1].split("/")[0]
    return url or str(uuid.uuid4())


def normalize_node(node: dict) -> dict:
    """Normalise one hacktivity node (the H1 GraphQL shape, or a flattened JSONL row) to a
    disclosure row. Tolerant of both nesting styles so the bot can emit either."""
    report = node.get("report") or node
    rgc = report.get("report_generated_content") or node.get("report_generated_content") or {}
    team = node.get("team") or {}
    reporter = node.get("reporter") or {}
    url = report.get("url") or node.get("url") or ""
    cwe = node.get("cwe") or report.get("cwe")
    class_id, family = engines.class_for_cwe(cwe) if cwe else (None, None)
    cve_ids = node.get("cve_ids") or report.get("cve_ids") or []
    amount = node.get("total_awarded_amount", node.get("bounty_amount"))
    return {
        "report_id":     _report_id(node, report, url),
        "source":        node.get("source", "hackerone"),
        "title":         (report.get("title") or node.get("title") or "")[:500],
        "url":           url,
        "program_handle": team.get("handle") or node.get("program_handle"),
        "program_name":  team.get("name") or node.get("program_name"),
        "severity":      node.get("severity_rating") or node.get("severity"),
        "cwe":           cwe,
        "cve_ids":       json.dumps(cve_ids if isinstance(cve_ids, list) else []),
        "bounty_amount": float(amount) if amount not in (None, "") else None,
        "currency":      team.get("currency") or node.get("currency"),
        "reporter":      reporter.get("username") or node.get("reporter"),
        "disclosed_at":  report.get("disclosed_at") or node.get("disclosed_at"),
        "summary":       (rgc.get("hacktivity_summary") or node.get("summary") or "")[:8000],
        "substate":      report.get("substate") or node.get("substate"),
        "class_id":      class_id,
        "family_num":    family,
    }


def _upsert(row: dict) -> bool:
    """Insert a disclosure if new (deduped by source+report_id). Returns True if inserted.
    Never overwrites an existing row's enrichment."""
    existing = db.query_one(
        "SELECT id FROM disclosures WHERE source=? AND report_id=?",
        [row["source"], row["report_id"]])
    if existing:
        return False
    db.insert("disclosures", {"id": str(uuid.uuid4()), **row, "ingested_at": _now()})
    return True


def ingest_jsonl(text: str) -> dict:
    """Ingest a JSONL feed (one hacktivity node per line). Returns {parsed, inserted, skipped,
    unmapped}. Malformed lines are skipped, never fatal."""
    parsed = inserted = skipped = unmapped = 0
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            node = json.loads(line)
        except json.JSONDecodeError:
            continue
        parsed += 1
        try:
            row = normalize_node(node)
        except Exception:  # noqa: BLE001 — one bad node never breaks the batch
            continue
        if not row.get("class_id"):
            unmapped += 1
        if _upsert(row):
            inserted += 1
        else:
            skipped += 1
    return {"parsed": parsed, "inserted": inserted, "skipped": skipped, "unmapped": unmapped}


def sync_from_github(owner: str, repo: str, path: str, ref: str = "HEAD",
                     timeout: int = 20) -> dict:
    """Primary path — fetch the bot-committed JSONL artifact from a public repo and ingest it.
    Public raw fetch; no auth, no private data. Returns the ingest counts (+ 'source_url')."""
    raw = f"{_RAW_GITHUB}/{owner}/{repo}/{ref}/{path}"
    req = urllib.request.Request(raw, headers={"User-Agent": "cyberbox-intel"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — fixed https host
        text = resp.read().decode("utf-8", errors="replace")
    result = ingest_jsonl(text)
    result["source_url"] = raw
    return result


def list_disclosures(class_id: str | None = None, program: str | None = None,
                     severity: str | None = None, enriched: bool | None = None,
                     limit: int = 200) -> list[dict]:
    sql = "SELECT * FROM disclosures"
    clauses, params = [], []
    if class_id:
        clauses.append("class_id=?"); params.append(class_id)
    if program:
        clauses.append("program_handle=?"); params.append(program)
    if severity:
        clauses.append("severity=?"); params.append(severity)
    if enriched is True:
        clauses.append("enriched_at IS NOT NULL")
    elif enriched is False:
        clauses.append("enriched_at IS NULL")
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY disclosed_at DESC, ingested_at DESC LIMIT ?"
    params.append(limit)
    return [db.decode_row(r) for r in db.query(sql, params)]


def get_disclosure(disclosure_id: str) -> dict | None:
    row = db.query_one("SELECT * FROM disclosures WHERE id=?", [disclosure_id])
    return db.decode_row(row) if row else None


def market_by_class() -> list[dict]:
    """Aggregate disclosures per taxonomy class → the market-validated priority overlay:
    count, paid count, median + max bounty, latest disclosure. Only mapped classes."""
    rows = db.query(
        "SELECT class_id, family_num, bounty_amount, disclosed_at FROM disclosures "
        "WHERE class_id IS NOT NULL")
    by_class: dict[str, dict] = {}
    for r in rows:
        c = by_class.setdefault(r["class_id"], {
            "class_id": r["class_id"], "family_num": r["family_num"],
            "count": 0, "paid_count": 0, "bounties": [], "latest": None})
        c["count"] += 1
        amt = r["bounty_amount"]
        if amt and amt > 0:
            c["paid_count"] += 1
            c["bounties"].append(amt)
        if r["disclosed_at"] and (c["latest"] is None or r["disclosed_at"] > c["latest"]):
            c["latest"] = r["disclosed_at"]
    out = []
    for c in by_class.values():
        bounties = sorted(c.pop("bounties"))
        c["median_bounty"] = bounties[len(bounties) // 2] if bounties else None
        c["max_bounty"] = bounties[-1] if bounties else None
        out.append(c)
    out.sort(key=lambda c: (c["max_bounty"] or 0, c["count"]), reverse=True)
    return out


# ── Fallback: direct H1 pull (sandbox / cf-bypass only; Cloudflare-blocked from a bare host) ──

_HACKTIVITY_QUERY = (
    "query HacktivitySearchQuery($queryString: String!, $from: Int, $size: Int, $sort: SortInput!) {"
    " search(index: CompleteHacktivityReportIndex, query_string: $queryString, from: $from,"
    " size: $size, sort: $sort) { total_count nodes { ... on HacktivityDocument { cwe cve_ids"
    " severity_rating total_awarded_amount reporter { username } team { handle name currency }"
    " report { _id title url substate disclosed_at report_generated_content { hacktivity_summary } } } } }")


def fetch_live(limit: int = 25, timeout: int = 20) -> list[dict]:
    """Fallback — query H1 hacktivity GraphQL directly and return raw nodes. Cloudflare blocks a
    bare host (403); intended to run from the sandbox pool with cf-bypass. Never raises: returns []
    on any error so callers can fall back to the repo JSONL."""
    body = json.dumps({
        "operationName": "HacktivitySearchQuery",
        "variables": {"queryString": "disclosed:true", "size": limit, "from": 0,
                      "sort": {"field": "latest_disclosable_activity_at", "direction": "DESC"}},
        "query": _HACKTIVITY_QUERY,
    }).encode()
    req = urllib.request.Request(
        _H1_GRAPHQL, data=body, method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0",
                 "x-product-area": "hacktivity", "x-product-feature": "overview"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — fixed https host
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        return data.get("data", {}).get("search", {}).get("nodes", []) or []
    except Exception:  # noqa: BLE001 — CF block / network / shape change all mean "no live data"
        return []


def ingest_live(limit: int = 25) -> dict:
    """Pull live nodes (fallback path) and ingest them. Empty result if CF-blocked."""
    nodes = fetch_live(limit)
    inserted = sum(1 for n in nodes if _upsert(normalize_node(n)))
    return {"fetched": len(nodes), "inserted": inserted}


# ── Enrichment — the "extra pull" that turns a disclosure into reusable methodology ──

_ENRICH_FIELDS = ("root_cause", "recurrence", "patch", "hunt_guidance",
                  "first_finder_edge", "improvement")

_ENRICH_SYSTEM = ("You are a bug-bounty methodology analyst. You turn a disclosed report into "
                  "reusable hunting methodology. Be concrete and specific; no fluff, no hedging. "
                  "Respond ONLY with a valid JSON object, no markdown.")


def _default_provider_id() -> str | None:
    row = db.query_one(
        "SELECT id FROM model_providers WHERE enabled=1 ORDER BY local DESC, name LIMIT 1")
    return row["id"] if row else None


def _enrich_prompt(d: dict) -> str:
    return (
        f"Disclosed report:\n"
        f"Title: {d.get('title')}\n"
        f"CWE: {d.get('cwe')}  Taxonomy class: {d.get('class_id') or 'unmapped'}\n"
        f"Severity: {d.get('severity')}  Bounty: {d.get('bounty_amount')} {d.get('currency') or ''}\n"
        f"Program: {d.get('program_name')}\n"
        f"Summary: {d.get('summary')}\n\n"
        "Produce a methodology breakdown as a JSON object with EXACTLY these keys, each 1-3 "
        "concrete sentences:\n"
        '- "root_cause": the underlying flaw that made this possible\n'
        '- "recurrence": the pattern/conditions under which this bug class recurs on other targets\n'
        '- "patch": how it is correctly fixed\n'
        '- "hunt_guidance": concrete step-by-step on how to hunt and reproduce this on a new target\n'
        '- "first_finder_edge": why this researcher likely found it first — what they looked at that others skipped\n'
        '- "improvement": how we should adjust our own hunting to catch this class earlier\n'
        "JSON only.")


def _parse_json(text: str) -> dict:
    text = text.strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return {}
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {}


def enrich_disclosure(disclosure_id: str, provider_id: str | None = None) -> dict:
    """Run the optional LLM enrichment pass over one disclosure and store the methodology fields.

    AI is optional (vision): with no enabled provider this returns status='no-model' and writes
    nothing. Never raises — a model/parse failure returns status='failed'. Already-enriched rows
    return status='cached' unless re-run."""
    d = get_disclosure(disclosure_id)
    if not d:
        return {"status": "not-found"}
    provider = provider_id or _default_provider_id()
    if not provider:
        return {"status": "no-model", "reason": "no enabled model provider — enrichment is optional"}
    try:
        text = model_svc.complete(
            [{"role": "user", "content": _enrich_prompt(d)}],
            provider_id=provider, system=_ENRICH_SYSTEM, max_tokens=900, temperature=0.2)
    except Exception as exc:  # noqa: BLE001
        return {"status": "failed", "reason": str(exc)[:200]}
    parsed = _parse_json(text)
    fields = {k: (parsed.get(k) or "").strip()[:2000] for k in _ENRICH_FIELDS}
    if not any(fields.values()):
        return {"status": "failed", "reason": "model returned no usable fields"}
    sets = ", ".join(f"{k}=?" for k in _ENRICH_FIELDS)
    db.execute(f"UPDATE disclosures SET {sets}, enriched_at=? WHERE id=?",
               [*[fields[k] for k in _ENRICH_FIELDS], _now(), disclosure_id])
    return {"status": "enriched", "fields": fields}
