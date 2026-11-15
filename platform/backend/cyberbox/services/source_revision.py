"""Source-revision model (audit #9) — patch-diff / silent-fix / regression tracking.

A `source` is something whose code changes over time and whose live revision you can observe
on a target: a GitLab/GitHub repo, a Vercel deploy project, a WordPress plugin. Revisions are
its commits/deploys/versions. A `revision_diff` records what changed between two revisions and
whether that change looks security-relevant (optionally linked to the advisory it fixes).

The payoff is `regression_candidates()`: a security-relevant fix diff whose *from_revision* is
exactly the revision still observed deployed on the target means the target is running the
pre-fix code — the silent-patch-still-vulnerable chain. Matching is on revision identity
(a commit/deploy is either the observed one or it isn't), never a guessed ordering of opaque
SHAs, so the signal is precise rather than heuristic.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from .. import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def register_source(kind: str, identifier: str, project_id: str | None = None,
                    engagement_id: str | None = None, label: str | None = None,
                    observed_revision: str | None = None, metadata: dict | None = None) -> str:
    """Insert or update a watched source by (kind, identifier). Returns the source id."""
    existing = db.query_one("SELECT id FROM sources WHERE kind=? AND identifier=?", [kind, identifier])
    source_id = existing["id"] if existing else str(uuid.uuid4())
    now = _now()
    row = {"id": source_id, "project_id": project_id, "engagement_id": engagement_id,
           "kind": kind, "identifier": identifier, "label": label,
           "observed_revision": observed_revision, "metadata": json.dumps(metadata or {}),
           "created_at": now, "updated_at": now}
    db.upsert("sources", row, conflict_cols=["kind", "identifier"],
              update_cols=["project_id", "engagement_id", "label", "observed_revision",
                           "metadata", "updated_at"])
    return source_id


def set_observed_revision(source_id: str, revision: str) -> None:
    """Record the revision seen live on the target — the anchor for regression detection."""
    db.execute("UPDATE sources SET observed_revision=?, updated_at=? WHERE id=?",
               [revision, _now(), source_id])


def add_revision(source_id: str, revision: str, parent_revision: str | None = None,
                 ref: str | None = None, authored_at: str | None = None,
                 metadata: dict | None = None) -> str:
    """Record a revision. Idempotent on (source_id, revision)."""
    existing = db.query_one("SELECT id FROM source_revisions WHERE source_id=? AND revision=?",
                            [source_id, revision])
    if existing:
        return existing["id"]
    rev_id = str(uuid.uuid4())
    db.insert("source_revisions", {"id": rev_id, "source_id": source_id, "revision": revision,
              "parent_revision": parent_revision, "ref": ref, "authored_at": authored_at,
              "metadata": json.dumps(metadata or {}), "created_at": _now()})
    return rev_id


def record_diff(source_id: str, from_revision: str, to_revision: str,
                files_changed: list[str] | None = None, summary: str | None = None,
                security_relevant: bool = False, advisory_id: str | None = None) -> str:
    """Record (or update) the diff between two revisions. Idempotent on the revision pair."""
    existing = db.query_one(
        "SELECT id FROM revision_diffs WHERE source_id=? AND from_revision=? AND to_revision=?",
        [source_id, from_revision, to_revision])
    diff_id = existing["id"] if existing else str(uuid.uuid4())
    row = {"id": diff_id, "source_id": source_id, "from_revision": from_revision,
           "to_revision": to_revision, "files_changed": json.dumps(files_changed or []),
           "summary": summary, "security_relevant": 1 if security_relevant else 0,
           "advisory_id": advisory_id, "created_at": _now()}
    db.upsert("revision_diffs", row, conflict_cols=["source_id", "from_revision", "to_revision"],
              update_cols=["files_changed", "summary", "security_relevant", "advisory_id"])
    return diff_id


def get_source(source_id: str) -> dict | None:
    row = db.query_one("SELECT * FROM sources WHERE id=?", [source_id])
    if not row:
        return None
    source = db.decode_row(row)
    source["revisions"] = [db.decode_row(r) for r in db.query(
        "SELECT * FROM source_revisions WHERE source_id=? ORDER BY authored_at, created_at", [source_id])]
    source["diffs"] = [db.decode_row(r) for r in db.query(
        "SELECT * FROM revision_diffs WHERE source_id=? ORDER BY created_at", [source_id])]
    return source


def list_sources(project_id: str | None = None, engagement_id: str | None = None,
                 kind: str | None = None, limit: int = 100) -> list[dict]:
    sql = "SELECT * FROM sources"
    clauses, params = [], []
    for col, val in (("project_id", project_id), ("engagement_id", engagement_id), ("kind", kind)):
        if val:
            clauses.append(f"{col}=?")
            params.append(val)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)
    return [db.decode_row(r) for r in db.query(sql, params)]


def regression_candidates(source_id: str | None = None,
                          project_id: str | None = None) -> list[dict]:
    """Security-relevant fix diffs whose from_revision is the revision still observed deployed.

    A hit means the target is running the pre-fix code of a known security fix — a concrete,
    identity-matched regression lead, not a heuristic. Sources with no observed_revision can't
    be judged and are skipped (they're surfaced separately by get_source).
    """
    sql = ("SELECT d.*, s.identifier, s.kind, s.observed_revision, s.project_id, s.engagement_id "
           "FROM revision_diffs d JOIN sources s ON s.id=d.source_id "
           "WHERE d.security_relevant=1 AND s.observed_revision IS NOT NULL "
           "AND s.observed_revision = d.from_revision")
    params: list = []
    if source_id:
        sql += " AND s.id=?"
        params.append(source_id)
    if project_id:
        sql += " AND s.project_id=?"
        params.append(project_id)
    sql += " ORDER BY d.created_at DESC"
    out = []
    for r in db.query(sql, params):
        hit = db.decode_row(r)
        hit["reason"] = (f"deployed revision {r['observed_revision']} is the pre-fix revision of a "
                         f"security-relevant diff -> target still vulnerable")
        out.append(hit)
    return out
