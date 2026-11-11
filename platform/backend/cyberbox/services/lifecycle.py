"""Six-stage investigation lifecycle: LEARN -> MAP -> COORDINATE -> TEST -> PROVE -> VERIFY.

This is the state machine the research primitives (hypotheses/experiments/findings in
`research.py`) hang off. A mission is one investigation. Its stage is never advanced on an
operator's say-so alone: each forward transition checks that the *entry prerequisite* for
the target stage is actually satisfied by real rows in the database, so the label can never
run ahead of the evidence. Two further guarantees live here:

  * historical-coverage pre-check — before an experiment is run, `is_covered()` reports
    whether an equivalent one (same target+method+procedure) already ran, so the engine
    doesn't re-test the same thing and manufacture duplicate work.

  * finder != validator — `verify_finding()` refuses to let the actor who produced a finding
    also be the one who confirms it. Verification by the finder is rejected, mirroring the
    XBOW finder/validator split.

The stages map onto existing data as follows (checked live, never trusted from a flag):
  LEARN      always reachable (the starting stage)
  MAP        >= 1 asset mapped for the engagement
  COORDINATE >= 1 hypothesis raised
  TEST       >= 1 experiment created
  PROVE      >= 1 experiment with a 'supported' verdict (a finding is promotable)
  VERIFY     >= 1 finding verified by a non-finder reviewer
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from .. import db
from . import events, research

STAGES = ["LEARN", "MAP", "COORDINATE", "TEST", "PROVE", "VERIFY"]
_STAGE_INDEX = {s: i for i, s in enumerate(STAGES)}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# missions
# ---------------------------------------------------------------------------
def create_mission(project_id: str, engagement_id: str, title: str,
                   created_by: str | None = None) -> dict:
    mission_id = str(uuid.uuid4())
    now = _now()
    row = {"id": mission_id, "project_id": project_id, "engagement_id": engagement_id,
           "title": title, "stage": "LEARN", "status": "active",
           "created_by": created_by, "created_at": now, "updated_at": now}
    db.insert("missions", row)
    db.insert("mission_stage_log", {
        "id": str(uuid.uuid4()), "mission_id": mission_id, "from_stage": None,
        "to_stage": "LEARN", "note": "mission created", "actor": created_by,
        "occurred_at": now})
    events.append(project_id, "mission.created", {"mission_id": mission_id, "title": title})
    return db.decode_row(row)


def get_mission(mission_id: str) -> dict | None:
    row = db.query_one("SELECT * FROM missions WHERE id=?", [mission_id])
    if not row:
        return None
    mission = db.decode_row(row)
    mission["readiness"] = stage_readiness(mission)
    mission["stage_log"] = [
        db.decode_row(r) for r in db.query(
            "SELECT * FROM mission_stage_log WHERE mission_id=? ORDER BY occurred_at", [mission_id])
    ]
    return mission


def list_missions(engagement_id: str | None = None, project_id: str | None = None,
                  limit: int = 100) -> list[dict]:
    sql = "SELECT * FROM missions"
    clauses, params = [], []
    if engagement_id:
        clauses.append("engagement_id=?")
        params.append(engagement_id)
    if project_id:
        clauses.append("project_id=?")
        params.append(project_id)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)
    return [db.decode_row(r) for r in db.query(sql, params)]


# ---------------------------------------------------------------------------
# stage prerequisites (evaluated live against real rows)
# ---------------------------------------------------------------------------
def _count(sql: str, params: list) -> int:
    row = db.query_one(sql, params)
    return int(row["n"]) if row else 0


def _prerequisite(mission: dict, stage: str) -> tuple[bool, str]:
    """Return (met, reason) for *entering* `stage` on this mission's engagement."""
    eng = mission["engagement_id"]
    proj = mission["project_id"]
    if stage == "LEARN":
        return True, "starting stage"
    if stage == "MAP":
        n = _count("SELECT COUNT(*) n FROM assets WHERE project_id=?", [proj])
        return (n > 0, f"{n} asset(s) mapped" if n else "no assets mapped for the project")
    if stage == "COORDINATE":
        n = _count("SELECT COUNT(*) n FROM hypotheses WHERE engagement_id=?", [eng])
        return (n > 0, f"{n} hypothesis(es) raised" if n else "no hypotheses raised")
    if stage == "TEST":
        n = _count("SELECT COUNT(*) n FROM experiments e JOIN hypotheses h "
                   "ON h.id=e.hypothesis_id WHERE h.engagement_id=?", [eng])
        return (n > 0, f"{n} experiment(s) created" if n else "no experiments created")
    if stage == "PROVE":
        n = _count("SELECT COUNT(*) n FROM experiments e JOIN hypotheses h ON h.id=e.hypothesis_id "
                   "WHERE h.engagement_id=? AND e.status='done' "
                   "AND json_extract(e.result,'$.verdict')='supported'", [eng])
        return (n > 0, f"{n} supported experiment(s)" if n else "no supported experiment to prove")
    if stage == "VERIFY":
        n = _count("SELECT COUNT(*) n FROM vulnerabilities v JOIN hypotheses h "
                   "ON h.id=(SELECT hypothesis_id FROM finding_links WHERE vulnerability_id=v.id LIMIT 1) "
                   "WHERE h.engagement_id=? AND v.verified=1", [eng])
        return (n > 0, f"{n} verified finding(s)" if n else "no verified finding")
    return False, f"unknown stage {stage!r}"


def stage_readiness(mission: dict) -> list[dict]:
    """For each stage, whether its entry prerequisite is currently met."""
    out = []
    for s in STAGES:
        met, reason = _prerequisite(mission, s)
        out.append({"stage": s, "met": met, "reason": reason,
                    "current": s == mission["stage"]})
    return out


def advance_stage(mission_id: str, to_stage: str, note: str | None = None,
                  actor: str | None = None) -> dict:
    """Move a mission to `to_stage`. Forward moves are one step at a time and gated on the
    target stage's prerequisite; backward moves (revisiting an earlier stage) are always
    allowed and need no prerequisite."""
    mission = db.query_one("SELECT * FROM missions WHERE id=?", [mission_id])
    if not mission:
        raise ValueError("mission not found")
    mission = db.decode_row(mission)
    if to_stage not in _STAGE_INDEX:
        raise ValueError(f"unknown stage {to_stage!r}")
    cur_i = _STAGE_INDEX[mission["stage"]]
    tgt_i = _STAGE_INDEX[to_stage]
    if tgt_i == cur_i:
        raise ValueError(f"mission already at stage {to_stage}")
    if tgt_i > cur_i:
        if tgt_i != cur_i + 1:
            raise ValueError(
                f"cannot skip from {mission['stage']} to {to_stage}; advance one stage at a time")
        met, reason = _prerequisite(mission, to_stage)
        if not met:
            raise ValueError(f"cannot enter {to_stage}: {reason}")
    now = _now()
    db.execute("UPDATE missions SET stage=?, updated_at=? WHERE id=?", [to_stage, now, mission_id])
    db.insert("mission_stage_log", {
        "id": str(uuid.uuid4()), "mission_id": mission_id, "from_stage": mission["stage"],
        "to_stage": to_stage, "note": note, "actor": actor, "occurred_at": now})
    events.append(mission["project_id"], "mission.stage_changed",
                  {"mission_id": mission_id, "from": mission["stage"], "to": to_stage})
    return get_mission(mission_id)


# ---------------------------------------------------------------------------
# historical-coverage pre-check
# ---------------------------------------------------------------------------
def coverage_fingerprint(target_url: str, method: str, procedure: str) -> str:
    """Stable fingerprint for an experiment's observable action."""
    key = f"{method.upper()}|{target_url.strip().rstrip('/')}|{procedure.strip()}"
    return hashlib.sha256(key.encode()).hexdigest()


def is_covered(engagement_id: str, target_url: str, method: str, procedure: str) -> dict | None:
    """If an equivalent experiment already ran under this engagement, return a summary of the
    most recent one; otherwise None. Lets the engine skip re-testing the same action."""
    fp = coverage_fingerprint(target_url, method, procedure)
    rows = db.query(
        "SELECT e.id, e.name, e.status, e.result, e.target_url, e.method, e.procedure, e.finished_at "
        "FROM experiments e JOIN hypotheses h ON h.id=e.hypothesis_id "
        "WHERE h.engagement_id=? ORDER BY e.created_at DESC", [engagement_id])
    for r in rows:
        if coverage_fingerprint(r["target_url"], r["method"], r["procedure"]) == fp:
            summary = db.decode_row(r)
            summary["fingerprint"] = fp
            return summary
    return None


# ---------------------------------------------------------------------------
# finder != validator
# ---------------------------------------------------------------------------
def _finder_of(finding_id: str) -> str | None:
    """The actor who produced a finding: the created_by of the hypothesis behind it."""
    row = db.query_one(
        "SELECT h.created_by FROM finding_links fl JOIN hypotheses h ON h.id=fl.hypothesis_id "
        "WHERE fl.vulnerability_id=? LIMIT 1", [finding_id])
    return row["created_by"] if row else None


def verify_finding(finding_id: str, reviewer_type: str, reviewer_id: str, verdict: str,
                   confidence: str, rationale: str, artifact_ids: list[str] | None = None) -> dict:
    """Review a finding under the finder != validator rule.

    The reviewer_id must differ from the finding's finder. A reviewer_type of
    'verifier'/'skeptic' with a 'confirmed' verdict marks the finding verified (via
    research.review_finding), and reviewer_id is recorded on the review row.
    """
    if not reviewer_id:
        raise ValueError("reviewer_id is required to enforce finder != validator")
    finder = _finder_of(finding_id)
    if finder is not None and finder == reviewer_id:
        raise ValueError(
            "finder != validator: the actor who produced this finding cannot verify it")
    review = research.review_finding(finding_id, reviewer_type, verdict, confidence,
                                     rationale, artifact_ids or [])
    db.execute("UPDATE finding_reviews SET reviewer_id=? WHERE id=?", [reviewer_id, review["id"]])
    review["reviewer_id"] = reviewer_id
    return review
