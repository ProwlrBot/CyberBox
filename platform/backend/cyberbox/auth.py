"""Local API-key auth with bootstrap admin on first boot."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException

from . import db
from .config import get_settings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def bootstrap_admin() -> dict:
    existing = db.query_one("SELECT * FROM users WHERE role='admin' LIMIT 1")
    if existing:
        return dict(existing)
    api_key = "cbx_" + secrets.token_urlsafe(32)
    user = {"id": str(uuid.uuid4()), "email": "admin@localhost", "name": "Administrator",
            "role": "admin", "api_key": api_key, "created_at": _now()}
    db.insert("users", user)
    key_file = get_settings().home / "admin.key"
    key_file.write_text(api_key)
    key_file.chmod(0o600)
    print(f"[cyberbox] admin API key: {api_key}  (written to {key_file})")
    return user


def create_user(email: str, name: str, role: str = "member") -> dict:
    user = {"id": str(uuid.uuid4()), "email": email, "name": name, "role": role,
            "api_key": "cbx_" + secrets.token_urlsafe(32), "created_at": _now()}
    db.insert("users", user)
    return user


def current_user(authorization: str | None = Header(default=None),
                 x_api_key: str | None = Header(default=None)) -> dict:
    key = x_api_key
    if not key and authorization and authorization.lower().startswith("bearer "):
        key = authorization[7:].strip()
    if not key:
        raise HTTPException(status_code=401, detail="missing API key")
    user = db.query_one("SELECT * FROM users WHERE api_key=?", [key])
    if not user:
        raise HTTPException(status_code=401, detail="invalid API key")
    return dict(user)


def require_admin(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="admin role required")
    return user
