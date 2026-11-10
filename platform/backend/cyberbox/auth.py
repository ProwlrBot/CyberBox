"""Local API-key auth with bootstrap admin on first boot."""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException

from . import db
from .config import get_settings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _key_digest(api_key: str) -> str:
    return "sha256:" + hashlib.sha256(api_key.encode()).hexdigest()


def authenticate_key(api_key: str | None) -> dict | None:
    if not api_key:
        return None
    user = db.query_one("SELECT * FROM users WHERE api_key=?", [_key_digest(api_key)])
    if user:
        return dict(user)
    # One-time compatibility path for databases created before key hashing.
    legacy = db.query_one("SELECT * FROM users WHERE api_key=?", [api_key])
    if legacy and api_key.startswith("cbx_"):
        db.execute("UPDATE users SET api_key=? WHERE id=?", [_key_digest(api_key), legacy["id"]])
        legacy["api_key"] = _key_digest(api_key)
        return dict(legacy)
    return None


def bootstrap_admin() -> dict:
    existing = db.query_one("SELECT * FROM users WHERE role='admin' LIMIT 1")
    if existing:
        key_file = get_settings().home / "admin.key"
        if key_file.is_file():
            migrated = authenticate_key(key_file.read_text().strip())
            if migrated:
                return migrated
        # Key file missing or stale — regenerate so server is always usable
        api_key = "cbx_" + secrets.token_urlsafe(32)
        db.execute("UPDATE users SET api_key=? WHERE id=?", [_key_digest(api_key), existing["id"]])
        key_file = get_settings().home / "admin.key"
        key_file.write_text(api_key)
        key_file.chmod(0o600)
        print(f"[cyberbox] admin API key regenerated → {key_file}")
        return dict(existing)
    api_key = "cbx_" + secrets.token_urlsafe(32)
    user = {"id": str(uuid.uuid4()), "email": "admin@localhost", "name": "Administrator",
            "role": "admin", "api_key": _key_digest(api_key), "created_at": _now()}
    db.insert("users", user)
    key_file = get_settings().home / "admin.key"
    key_file.write_text(api_key)
    key_file.chmod(0o600)
    print(f"[cyberbox] admin API key written to {key_file}")
    return user


def create_user(email: str, name: str, role: str = "member") -> dict:
    api_key = "cbx_" + secrets.token_urlsafe(32)
    user = {"id": str(uuid.uuid4()), "email": email, "name": name, "role": role,
            "api_key": _key_digest(api_key), "created_at": _now()}
    db.insert("users", user)
    return {**user, "api_key": api_key}


def current_user(authorization: str | None = Header(default=None),
                 x_api_key: str | None = Header(default=None)) -> dict:
    key = x_api_key
    if not key and authorization and authorization.lower().startswith("bearer "):
        key = authorization[7:].strip()
    if not key:
        raise HTTPException(status_code=401, detail="missing API key")
    user = authenticate_key(key)
    if not user:
        raise HTTPException(status_code=401, detail="invalid API key")
    return dict(user)


def require_admin(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="admin role required")
    return user


def require_internal_service(x_cyberbox_internal_token: str | None = Header(default=None)) -> None:
    expected = get_settings().internal_service_token
    if not expected:
        raise HTTPException(status_code=503, detail="internal service bridge disabled")
    if not x_cyberbox_internal_token or not secrets.compare_digest(
            x_cyberbox_internal_token, expected):
        raise HTTPException(status_code=403, detail="internal service token denied")
