"""The methodology spine — the bug-bounty finding taxonomy as a first-class model.

This is the framework backbone. Families and classes come from a versioned JSON data file
(`data/taxonomy.json`), seeded idempotently into the DB so coverage can reference stable class
ids. Three things live here that tools and AI cannot commoditize:

  * coverage(project)      — what classes you've actually worked on a target (none/partial/covered)
  * reachable_chains()     — the §23 escalation matcher: given what you've found, which chains to
                             a critical are now in reach, and which single component you still need
  * reportability()        — the anti-slop gate: informational-only classes are never reportable
                             standalone, only inside a chain, and every report clears the checklist

Tools, scanners, cve-intel, RedAmon, AI providers — all of those are *engines* that produce
evidence which marks a class covered. They plug in around this spine; they are not it.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from .. import db

_DATA = Path(__file__).resolve().parent.parent / "data" / "taxonomy.json"
_METH = Path(__file__).resolve().parent.parent / "data" / "methodologies.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@lru_cache(maxsize=1)
def _load() -> dict:
    return json.loads(_DATA.read_text())


@lru_cache(maxsize=1)
def _load_methodologies() -> dict:
    return json.loads(_METH.read_text())


def class_id(family_num: int, name: str) -> str:
    """Deterministic, stable slug so coverage survives re-seeds."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"f{family_num}-{slug}"[:120]


# ── Seeding ──────────────────────────────────────────────────────────────────────

def ensure_seeded() -> dict:
    """Idempotently load families/classes/chains from the JSON spine. Safe to call on boot."""
    data = _load()
    # One transaction for the whole seed: 386 class upserts + chains + prune commit once, not
    # 400+ times. On WSL2 (synchronous=FULL) this is the difference between ~40s and <1s of boot.
    with db.batch():
        for fam in data["families"]:
            db.upsert("taxonomy_families",
                      {"num": fam["num"], "name": fam["name"], "owasp": fam.get("owasp"),
                       "money_rank": fam.get("money_rank"), "note": fam.get("note")},
                      conflict_cols=["num"], update_cols=["name", "owasp", "money_rank", "note"])
        for c in data["classes"]:
            cid = class_id(c["family"], c["name"])
            db.upsert("taxonomy_classes",
                      {"id": cid, "family_num": c["family"], "name": c["name"],
                       "priority": c["priority"], "payout_rank": c["payout_rank"], "cwe": c.get("cwe"),
                       "signal": c.get("signal"),
                       "informational_only": 1 if c.get("informational_only") else 0,
                       "chain_component": 1 if c.get("chain_component") else 0},
                      conflict_cols=["id"],
                      update_cols=["family_num", "name", "priority", "payout_rank", "cwe", "signal",
                                   "informational_only", "chain_component"])
        valid_chain_ids = []
        for ch in data["chains"]:
            chid = "chain-" + re.sub(r"[^a-z0-9]+", "-", ch["name"].lower()).strip("-")[:100]
            valid_chain_ids.append(chid)
            # Resolve each component's class reference to a stable class id (or null = manual
            # condition the harness cannot auto-confirm). Matching is on this id — never fuzzy text.
            components = []
            for comp in ch["components"]:
                cref = class_id(comp["family"], comp["name"]) if comp.get("name") and comp.get("family") else None
                components.append({"text": comp["text"], "class_id": cref})
            db.upsert("chain_recipes",
                      {"id": chid, "name": ch["name"], "result_impact": ch["result_impact"],
                       "result_priority": ch["result_priority"], "components": json.dumps(components)},
                      conflict_cols=["id"], update_cols=["name", "result_impact", "result_priority", "components"])

        # Per-class methodology: deterministic steps + optional AI hook. Only classes that exist
        # in the spine get a methodology row (FK-safe); unknown refs are skipped, not invented.
        valid_method_ids = []
        for m in _load_methodologies()["methodologies"]:
            mid = class_id(m["family"], m["name"])
            if not db.query_one("SELECT id FROM taxonomy_classes WHERE id=?", [mid]):
                continue  # class not in spine (renamed/removed) — skip rather than orphan
            valid_method_ids.append(mid)
            db.upsert("class_methodology",
                      {"class_id": mid, "steps": json.dumps(m["steps"]),
                       "ai_hook": m.get("ai_hook"), "updated_at": _now()},
                      conflict_cols=["class_id"], update_cols=["steps", "ai_hook", "updated_at"])

        # Seeding is AUTHORITATIVE: prune classes/chains/methodologies no longer in the spine so a
        # rename never leaves a stale orphan behind. target_coverage rows are left intact — a LEFT
        # JOIN from taxonomy_classes means orphaned coverage simply never surfaces, no data lost.
        valid_class_ids = [class_id(c["family"], c["name"]) for c in data["classes"]]
        valid_family_nums = [f["num"] for f in data["families"]]
        # Prune methodology rows first — they FK to taxonomy_classes, so a dangling methodology for
        # a renamed class would otherwise block that class's own prune below.
        _prune("class_methodology", "class_id", valid_method_ids)
        _prune("chain_recipes", "id", valid_chain_ids)
        _prune("taxonomy_classes", "id", valid_class_ids)
        _prune("taxonomy_families", "num", valid_family_nums)

    return {"families": len(data["families"]), "classes": len(data["classes"]),
            "chains": len(data["chains"]), "version": data["version"]}


def _prune(table: str, key: str, keep: list) -> int:
    """Delete rows of `table` whose `key` is not in `keep`. Returns rows removed."""
    if not keep:
        return 0
    placeholders = ",".join("?" for _ in keep)
    rows = db.query(f"SELECT {key} FROM {table} WHERE {key} NOT IN ({placeholders})", list(keep))
    for r in rows:
        db.execute(f"DELETE FROM {table} WHERE {key}=?", [r[key]])
    return len(rows)


# ── Reads ────────────────────────────────────────────────────────────────────────

def list_families() -> list[dict]:
    return db.query("SELECT * FROM taxonomy_families ORDER BY num")


def list_classes(family_num: int | None = None) -> list[dict]:
    if family_num is not None:
        return db.query("SELECT * FROM taxonomy_classes WHERE family_num=? ORDER BY payout_rank DESC, name",
                        [family_num])
    return db.query("SELECT * FROM taxonomy_classes ORDER BY family_num, payout_rank DESC, name")


def informational_list() -> list[str]:
    return _load()["informational_standalone"]


def reporting_checklist() -> list[str]:
    return _load()["reporting_checklist"]


# ── Coverage ─────────────────────────────────────────────────────────────────────

_STATUSES = {"none", "partial", "covered"}


def coverage(project_id: str) -> list[dict]:
    """Every class with the target's coverage status merged in."""
    rows = db.query(
        "SELECT c.*, COALESCE(tc.status,'none') AS status, tc.evidence_ids, tc.note, tc.updated_at "
        "FROM taxonomy_classes c "
        "LEFT JOIN target_coverage tc ON tc.class_id=c.id AND tc.project_id=? "
        "ORDER BY c.family_num, c.payout_rank DESC, c.name", [project_id])
    for r in rows:
        r["evidence_ids"] = json.loads(r["evidence_ids"]) if r.get("evidence_ids") else []
    return rows


def set_coverage(project_id: str, class_id_: str, status: str,
                 evidence_ids: list[str] | None = None, note: str | None = None) -> dict:
    if status not in _STATUSES:
        raise ValueError(f"status must be one of {sorted(_STATUSES)}")
    if not db.query_one("SELECT id FROM taxonomy_classes WHERE id=?", [class_id_]):
        raise ValueError("unknown taxonomy class")
    existing = db.query_one("SELECT id FROM target_coverage WHERE project_id=? AND class_id=?",
                            [project_id, class_id_])
    row = {"id": existing["id"] if existing else str(uuid.uuid4()),
           "project_id": project_id, "class_id": class_id_, "status": status,
           "evidence_ids": json.dumps(evidence_ids or []), "note": note, "updated_at": _now()}
    db.upsert("target_coverage", row, conflict_cols=["project_id", "class_id"],
              update_cols=["status", "evidence_ids", "note", "updated_at"])
    return row


def coverage_summary(project_id: str) -> dict:
    classes = coverage(project_id)
    by_status = {"none": 0, "partial": 0, "covered": 0}
    families: dict[int, dict] = {}
    for c in classes:
        by_status[c["status"]] = by_status.get(c["status"], 0) + 1
        fam = families.setdefault(c["family_num"], {"family_num": c["family_num"], "total": 0, "covered": 0})
        fam["total"] += 1
        if c["status"] == "covered":
            fam["covered"] += 1
    return {"total": len(classes), "by_status": by_status,
            "families": sorted(families.values(), key=lambda f: f["family_num"])}


# ── Chain escalation matcher (§23) ───────────────────────────────────────────────

def reachable_chains(project_id: str) -> list[dict]:
    """The escalation suggester. For every §23 chain, report which components the target already
    satisfies (a class-mapped component the target has covered/partial) and which are still
    missing — turning a set of medium findings into a mapped path to a critical.

    Matching is exact on class id, never fuzzy text, so the harness never over-claims a chain is
    complete. A component with no class mapping is a *manual* condition (e.g. "IMDSv1 reachable")
    the hunter must confirm themselves — it is always shown as still-needed, so `ready` only fires
    when every component is a class the target has actually covered.

    `ready` chains are fully in reach; `lead` chains have at least one component but not all. Sorted
    leads-by-completeness under ready, so the next move is always on top."""
    covered_ids = {c["id"] for c in coverage(project_id) if c["status"] in ("covered", "partial")}
    out = []
    for ch in db.query("SELECT * FROM chain_recipes ORDER BY name"):
        components = json.loads(ch["components"])
        mapped = []
        for comp in components:
            have = bool(comp.get("class_id")) and comp["class_id"] in covered_ids
            mapped.append({"text": comp["text"], "class_id": comp.get("class_id"),
                           "manual": comp.get("class_id") is None, "have": have})
        have_n = sum(1 for m in mapped if m["have"])
        if have_n == 0:
            continue  # nothing covered toward this chain yet
        out.append({
            "id": ch["id"], "name": ch["name"], "result_impact": ch["result_impact"],
            "result_priority": ch["result_priority"], "components": mapped,
            "have": have_n, "total": len(components),
            "ready": have_n == len(components),
            "missing": [m["text"] + (" (confirm manually)" if m["manual"] else "")
                        for m in mapped if not m["have"]],
        })
    out.sort(key=lambda c: (not c["ready"], -(c["have"] / c["total"]), c["total"] - c["have"]))
    return out


# ── Anti-slop reportability gate (§24/§25) ───────────────────────────────────────

def methodology(class_id_: str) -> dict:
    """The codified per-class playbook: deterministic steps plus an optional AI-enhancement hook.

    `has_methodology` is False for classes not yet authored — the UI shows the signal and gate, and
    this is where the next methodology gets written. Steps are tool-agnostic and deterministic; the
    ai_hook is a light, optional enhancement, never required to execute the class."""
    cls = db.query_one("SELECT id, name, family_num FROM taxonomy_classes WHERE id=?", [class_id_])
    if not cls:
        raise ValueError("unknown taxonomy class")
    row = db.query_one("SELECT steps, ai_hook FROM class_methodology WHERE class_id=?", [class_id_])
    steps = json.loads(row["steps"]) if row and row.get("steps") else []
    return {
        "class_id": cls["id"], "class_name": cls["name"], "family_num": cls["family_num"],
        "has_methodology": bool(steps),
        "steps": steps,
        "ai_hook": row["ai_hook"] if row else None,
    }


def reportability(class_id_: str) -> dict:
    """Is a finding of this class worth reporting on its own? Informational-only classes never are
    — they only pay inside a chain. Returns the standalone verdict, the chains the class feeds, and
    the reporting checklist every submission must clear."""
    cls = db.query_one("SELECT * FROM taxonomy_classes WHERE id=?", [class_id_])
    if not cls:
        raise ValueError("unknown taxonomy class")
    info_only = bool(cls["informational_only"])
    feeds = []
    for ch in db.query("SELECT * FROM chain_recipes"):
        if any(comp.get("class_id") == class_id_ for comp in json.loads(ch["components"])):
            feeds.append({"id": ch["id"], "name": ch["name"], "result_priority": ch["result_priority"]})
    return {
        "class": cls["name"], "priority": cls["priority"], "payout_rank": cls["payout_rank"],
        "reportable_standalone": not info_only,
        "reason": ("informational standalone — report only inside a chain or when the program "
                   "explicitly asks" if info_only else "has standalone impact when demonstrated"),
        "feeds_chains": feeds,
        "checklist": reporting_checklist(),
    }
