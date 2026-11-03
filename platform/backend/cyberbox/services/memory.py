"""Explicit researcher feedback and user-approved memory."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from .. import db
from . import events

DISPOSITIONS = {"confirmed", "rejected", "duplicate", "out-of-scope", "informative", "flaky", "false-positive"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_feedback(project_id: str, engagement_id: str | None, subject_type: str,
                    subject_id: str, disposition: str, notes: str, artifact_ids: list[str],
                    user_id: str) -> dict:
    if disposition not in DISPOSITIONS:
        raise ValueError("unsupported feedback disposition")
    profile_id = "bug-bounty"
    if engagement_id:
        engagement = db.query_one("SELECT profile_id FROM engagements WHERE id=? AND project_id=?",
                                  [engagement_id, project_id])
        if not engagement:
            raise ValueError("engagement does not belong to project")
        profile_id = engagement["profile_id"]
    for artifact_id in artifact_ids:
        if not db.query_one("SELECT id FROM artifacts WHERE id=? AND project_id=?", [artifact_id, project_id]):
            raise ValueError(f"artifact does not belong to project: {artifact_id}")
    row = {"id": str(uuid.uuid4()), "project_id": project_id, "engagement_id": engagement_id,
           "subject_type": subject_type, "subject_id": subject_id, "disposition": disposition,
           "notes": notes, "artifact_ids": json.dumps(artifact_ids), "created_by": user_id,
           "created_at": _now()}
    db.insert("research_feedback", row)
    suggestion = {"id": str(uuid.uuid4()), "project_id": project_id, "feedback_id": row["id"],
                  "profile_id": profile_id, "title": f"{disposition}: {subject_type}",
                  "lesson": notes, "technology_tags": "[]", "evidence_ids": json.dumps(artifact_ids),
                  "status": "pending", "decided_by": None, "decided_at": None, "created_at": _now()}
    db.insert("memory_suggestions", suggestion)
    if disposition in ("false-positive", "rejected"):
        db.insert("evaluation_fixtures", {"id": str(uuid.uuid4()), "project_id": project_id,
                  "fixture_type": "negative", "subject_type": subject_type, "subject_id": subject_id,
                  "expected": json.dumps({"disposition": disposition, "notes": notes}, sort_keys=True),
                  "artifact_ids": json.dumps(artifact_ids), "source_feedback_id": row["id"],
                  "created_at": _now()})
    events.append(project_id, "feedback.recorded", {"feedback_id": row["id"],
                  "disposition": disposition, "memory_suggestion_id": suggestion["id"]},
                  actor_type="user", actor_id=user_id)
    return {"feedback": db.decode_row(row), "suggestion": db.decode_row(suggestion)}


def decide_suggestion(suggestion_id: str, decision: str, user_id: str,
                      title: str | None = None, lesson: str | None = None,
                      technology_tags: list[str] | None = None) -> dict:
    suggestion = db.query_one("SELECT * FROM memory_suggestions WHERE id=?", [suggestion_id])
    if not suggestion or suggestion["status"] != "pending":
        raise ValueError("pending memory suggestion not found")
    if decision not in ("approved", "rejected"):
        raise ValueError("memory decision must be approved or rejected")
    now = _now()
    db.execute("UPDATE memory_suggestions SET status=?, decided_by=?, decided_at=? WHERE id=?",
               [decision, user_id, now, suggestion_id])
    memory_item = None
    if decision == "approved":
        final_lesson = (lesson if lesson is not None else suggestion["lesson"]).strip()
        if not final_lesson:
            raise ValueError("approved memory requires a lesson")
        memory_item = {"id": str(uuid.uuid4()), "project_id": suggestion["project_id"],
                       "profile_id": suggestion["profile_id"],
                       "title": (title or suggestion["title"]).strip(), "lesson": final_lesson,
                       "technology_tags": json.dumps(sorted(set(technology_tags or []))),
                       "evidence_ids": suggestion["evidence_ids"],
                       "source_feedback_id": suggestion["feedback_id"], "approved_by": user_id,
                       "approved_at": now, "active": 1}
        db.insert("research_memory", memory_item)
    events.append(suggestion["project_id"], f"memory.{decision}",
                  {"suggestion_id": suggestion_id,
                   "memory_id": memory_item["id"] if memory_item else None},
                  actor_type="user", actor_id=user_id)
    return {"suggestion": db.decode_row(db.query_one(
        "SELECT * FROM memory_suggestions WHERE id=?", [suggestion_id])),
            "memory": db.decode_row(memory_item) if memory_item else None}


def search(query: str, profile_id: str, project_id: str | None = None, limit: int = 10) -> list[dict]:
    terms = {term for term in query.lower().split() if len(term) > 1}
    rows = db.query("SELECT * FROM research_memory WHERE active=1 AND profile_id=?", [profile_id])
    matches = []
    for row in rows:
        if row["project_id"] and project_id and row["project_id"] != project_id:
            continue
        haystack = f"{row['title']} {row['lesson']} {row['technology_tags']}".lower()
        score = sum(1 for term in terms if term in haystack)
        if score:
            item = db.decode_row(row)
            item["score"] = score
            item["match_reason"] = sorted(term for term in terms if term in haystack)
            matches.append(item)
    return sorted(matches, key=lambda item: (-item["score"], item["approved_at"]))[:limit]
