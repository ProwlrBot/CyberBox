"""Append-only platform event journal."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from .. import db
from ..hub import hub


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def append(project_id: str, event_type: str, data: dict[str, Any],
           execution_id: str | None = None, actor_type: str = "system",
           actor_id: str | None = None) -> dict:
    row = {
        "execution_id": execution_id,
        "project_id": project_id,
        "event_type": event_type,
        "actor_type": actor_type,
        "actor_id": actor_id,
        "data": json.dumps(data, sort_keys=True),
        "created_at": _now(),
    }
    db.insert("execution_events", row)
    stored = db.query_one("SELECT * FROM execution_events WHERE id=last_insert_rowid()") or row
    decoded = db.decode_row(stored)
    hub.broadcast(event_type, decoded)
    return decoded


def list_for_project(project_id: str, after_id: int = 0, limit: int = 200) -> list[dict]:
    rows = db.query(
        "SELECT * FROM execution_events WHERE project_id=? AND id>? ORDER BY id LIMIT ?",
        [project_id, after_id, min(max(limit, 1), 1000)],
    )
    return [db.decode_row(row) for row in rows]
