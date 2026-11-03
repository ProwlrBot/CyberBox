"""Content-addressed artifact storage."""
from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .. import db
from ..config import get_settings
from . import events


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def store(project_id: str, kind: str, content: bytes, media_type: str,
          execution_id: str | None = None, metadata: dict | None = None) -> dict:
    digest = hashlib.sha256(content).hexdigest()
    existing = db.query_one(
        "SELECT * FROM artifacts WHERE project_id=? AND sha256=? AND kind=?",
        [project_id, digest, kind],
    )
    if existing:
        return db.decode_row(existing)

    target = get_settings().artifacts_dir / digest[:2] / digest
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temp = target.with_name(f".{digest}.{uuid.uuid4().hex}.tmp")
        temp.write_bytes(content)
        os.chmod(temp, 0o600)
        os.replace(temp, target)

    row = {
        "id": str(uuid.uuid4()), "project_id": project_id,
        "execution_id": execution_id, "kind": kind, "media_type": media_type,
        "sha256": digest, "size": len(content), "storage_path": str(target),
        "metadata": json.dumps(metadata or {}, sort_keys=True), "created_at": _now(),
    }
    db.insert("artifacts", row)
    events.append(project_id, "artifact.created", {"artifact_id": row["id"], "kind": kind,
                  "sha256": digest, "size": len(content)}, execution_id)
    return db.decode_row(row)


def read(artifact_id: str) -> tuple[dict, bytes] | None:
    row = db.query_one("SELECT * FROM artifacts WHERE id=?", [artifact_id])
    if not row:
        return None
    path = Path(row["storage_path"])
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != row["sha256"]:
        return None
    return db.decode_row(row), path.read_bytes()
