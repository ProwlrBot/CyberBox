"""Short-lived capability tokens for panels and providers."""
from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from .. import db

TOKEN_PREFIX = "cbcap_"
MAX_TTL_SECONDS = 3600
DEFAULT_TTL_SECONDS = 900
SYSTEM_PROJECT_ID = "cyberbox-system"
SYSTEM_PROJECT_SLUG = "cyberbox-system"
INTERNAL_PERMISSIONS = {"evidence.write", "plugin.registry.sync", "service.read", "service.restart"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _digest(token: str) -> str:
    return "sha256:" + hashlib.sha256(token.encode()).hexdigest()


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value)


def ensure_system_project() -> str:
    if db.query_one("SELECT id FROM projects WHERE id=?", [SYSTEM_PROJECT_ID]):
        return SYSTEM_PROJECT_ID
    now = _now().isoformat()
    db.upsert("projects", {
        "id": SYSTEM_PROJECT_ID,
        "slug": SYSTEM_PROJECT_SLUG,
        "name": "CyberBox System",
        "description": "Internal CyberBox control-plane events and capability grants.",
        "created_at": now,
    }, ["id"], ["slug", "name", "description"])
    return SYSTEM_PROJECT_ID


def issue(project_id: str, subject_type: str, subject_id: str, permissions: list[str],
          issued_by: str | None, engagement_id: str | None = None,
          ttl_seconds: int = DEFAULT_TTL_SECONDS,
          metadata: dict | None = None) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise ValueError("project not found")
    if engagement_id:
        engagement = db.query_one(
            "SELECT project_id FROM engagements WHERE id=?", [engagement_id])
        if not engagement or engagement["project_id"] != project_id:
            raise ValueError("engagement not found in project")
    normalized_permissions = sorted({permission.strip() for permission in permissions if permission.strip()})
    if not normalized_permissions:
        raise ValueError("at least one permission is required")
    ttl = min(max(ttl_seconds, 1), MAX_TTL_SECONDS)
    raw_token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    row = {
        "id": str(uuid.uuid4()),
        "token_digest": _digest(raw_token),
        "project_id": project_id,
        "engagement_id": engagement_id,
        "subject_type": subject_type,
        "subject_id": subject_id,
        "permissions": json.dumps(normalized_permissions),
        "status": "active",
        "issued_by": issued_by,
        "issued_at": _now().isoformat(),
        "expires_at": (_now() + timedelta(seconds=ttl)).isoformat(),
        "last_used_at": None,
        "revoked_at": None,
        "metadata": json.dumps(metadata or {}, sort_keys=True),
    }
    db.insert("capability_tokens", row)
    return {**db.decode_row(row), "token": raw_token}


def issue_internal(subject_type: str, subject_id: str, permissions: list[str],
                   project_id: str | None = None, engagement_id: str | None = None,
                   ttl_seconds: int = 120, metadata: dict | None = None) -> dict:
    normalized = sorted({permission.strip() for permission in permissions if permission.strip()})
    if not normalized or any(permission not in INTERNAL_PERMISSIONS for permission in normalized):
        raise ValueError("internal permission not allowed")
    return issue(project_id or ensure_system_project(), subject_type, subject_id, normalized,
                 None, engagement_id, ttl_seconds, metadata)


def verify(token: str | None, permission: str, project_id: str | None = None,
           engagement_id: str | None = None) -> dict:
    if not token or not token.startswith(TOKEN_PREFIX):
        raise PermissionError("missing capability token")
    row = db.query_one("SELECT * FROM capability_tokens WHERE token_digest=?", [_digest(token)])
    if not row:
        raise PermissionError("invalid capability token")
    decoded = db.decode_row(row)
    if decoded["status"] != "active":
        raise PermissionError("capability token is not active")
    if decoded["revoked_at"]:
        raise PermissionError("capability token is revoked")
    if _parse_time(decoded["expires_at"]) <= _now():
        raise PermissionError("capability token expired")
    if project_id and decoded["project_id"] != project_id:
        raise PermissionError("capability project mismatch")
    if engagement_id and decoded["engagement_id"] != engagement_id:
        raise PermissionError("capability engagement mismatch")
    if permission not in decoded["permissions"]:
        raise PermissionError("capability permission denied")
    db.execute("UPDATE capability_tokens SET last_used_at=? WHERE id=?",
               [_now().isoformat(), decoded["id"]])
    return db.decode_row(db.query_one(
        "SELECT * FROM capability_tokens WHERE id=?", [decoded["id"]]) or row)


def revoke(capability_id: str, project_id: str | None = None) -> dict:
    row = db.query_one("SELECT * FROM capability_tokens WHERE id=?", [capability_id])
    if not row:
        raise ValueError("capability token not found")
    if project_id and row["project_id"] != project_id:
        raise ValueError("capability token not found in project")
    db.execute("UPDATE capability_tokens SET status='revoked', revoked_at=? WHERE id=?",
               [_now().isoformat(), capability_id])
    return db.decode_row(db.query_one(
        "SELECT * FROM capability_tokens WHERE id=?", [capability_id]) or row)
