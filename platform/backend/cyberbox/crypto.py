"""At-rest encryption for integration secrets (Fernet/AES-128-CBC+HMAC)."""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings


def _load_key() -> bytes:
    env = os.environ.get("CYBERBOX_SECRET_KEY", os.environ.get("NEO_SECRET_KEY"))
    if env:
        try:
            Fernet(env.encode())
            return env.encode()
        except Exception:  # noqa: BLE001
            import hashlib
            return base64.urlsafe_b64encode(hashlib.sha256(env.encode()).digest())
    path = get_settings().home / "secret.key"
    if path.exists():
        return path.read_bytes()
    key = Fernet.generate_key()
    path.write_bytes(key)
    path.chmod(0o600)
    return key


_fernet: Fernet | None = None


def _f() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_key())
    return _fernet


def encrypt_config(data: dict) -> str:
    return _f().encrypt(json.dumps(data).encode()).decode()


def decrypt_config(blob: str) -> dict:
    if not blob or blob == "{}":
        return {}
    try:
        return json.loads(_f().decrypt(blob.encode()).decode())
    except (InvalidToken, json.JSONDecodeError):
        return {}
