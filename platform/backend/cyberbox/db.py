"""SQLite access layer."""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

from .config import get_settings

_local = threading.local()
_lock = threading.RLock()  # RLock: init_db() holds lock then calls conn()→_connect()


def _connect() -> sqlite3.Connection:
    # Serialize initial connections — journal_mode=DELETE conversion needs exclusive lock.
    # On WSL2, WAL mode's mmap-based SHM causes permanent hangs; DELETE mode avoids it.
    with _lock:
        c = sqlite3.connect(get_settings().db_path, check_same_thread=False, timeout=60)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode = DELETE")
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA busy_timeout = 15000")
        c.execute("PRAGMA synchronous = OFF")  # WSL2: skip fsync on every commit
        return c


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = _connect()
        _local.conn = c
    return c


def ensure_delete_journal() -> None:
    """WAL→DELETE migration. Uses backup() API to avoid WSL2 mmap/SHM hang.
    Safe to call every startup — no-op when already in DELETE mode."""
    import shutil
    import os
    db_path = get_settings().db_path

    # Quick check: if already in DELETE mode and no WAL file, skip
    wal_path = str(db_path) + "-wal"
    shm_path = str(db_path) + "-shm"
    has_wal = os.path.exists(wal_path)
    if not has_wal:
        c = sqlite3.connect(str(db_path), timeout=10)
        mode = c.execute("PRAGMA journal_mode").fetchone()[0]
        c.close()
        if mode == "delete":
            return  # already good

    # Merge WAL into a fresh DB in DELETE mode via backup() API (no SHM needed)
    tmp_path = str(db_path) + ".migrate_tmp"
    try:
        src = sqlite3.connect(str(db_path), timeout=10, isolation_level=None)
        src.execute("PRAGMA busy_timeout = 5000")
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        dst = sqlite3.connect(tmp_path, isolation_level=None)
        src.backup(dst)
        src.close()
        dst.execute("PRAGMA journal_mode = DELETE")
        dst.execute("PRAGMA synchronous = OFF")
        dst.close()
        # Remove any WAL/SHM created during dst operations
        for ext in ["-wal", "-shm"]:
            p = tmp_path + ext
            if os.path.exists(p):
                os.unlink(p)
        shutil.move(tmp_path, str(db_path))
        for ext in ["-wal", "-shm"]:
            p = str(db_path) + ext
            if os.path.exists(p):
                os.unlink(p)
    except Exception as exc:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise RuntimeError(f"journal_mode migration failed: {exc}") from exc


def init_db() -> None:
    schema = (Path(__file__).parent / "schema.sql").read_text()
    with _lock:
        conn().executescript(schema)
        conn().commit()


def query(sql: str, params: Iterable[Any] = ()) -> list[dict]:
    return [dict(r) for r in conn().execute(sql, tuple(params)).fetchall()]


def query_one(sql: str, params: Iterable[Any] = ()) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Iterable[Any] = ()) -> None:
    with _lock:
        conn().execute(sql, tuple(params))
        conn().commit()


def insert(table: str, row: dict) -> dict:
    cols = ", ".join(row.keys())
    placeholders = ", ".join("?" for _ in row)
    with _lock:
        conn().execute(f"INSERT INTO {table} ({cols}) VALUES ({placeholders})", tuple(row.values()))
        conn().commit()
    return row


def upsert(table: str, row: dict, conflict_cols: list[str], update_cols: list[str]) -> None:
    cols = ", ".join(row.keys())
    placeholders = ", ".join("?" for _ in row)
    conflict = ", ".join(conflict_cols)
    updates = ", ".join(f"{c}=excluded.{c}" for c in update_cols)
    sql = (f"INSERT INTO {table} ({cols}) VALUES ({placeholders}) "
           f"ON CONFLICT ({conflict}) DO UPDATE SET {updates}")
    with _lock:
        conn().execute(sql, tuple(row.values()))
        conn().commit()


JSON_COLUMNS = {
    "technologies", "labels", "metadata", "tags", "phase_checklist",
    "severity_counts", "working_memory", "stats", "request_chain",
    "req_headers", "resp_headers", "variables", "config",
    "budget", "policy", "ports", "methods", "input", "output",
    "data", "manifest",
    "inputs", "context", "supporting_artifacts", "contradicting_artifacts",
    "knowledge_citations", "result", "artifact_ids", "finding_ids",
    "technology_tags", "evidence_ids", "expected",
    "allowed_methods", "permissions",
}


def decode_row(row: dict) -> dict:
    out = dict(row)
    for col in JSON_COLUMNS:
        if col in out and isinstance(out[col], str):
            try:
                out[col] = json.loads(out[col])
            except (json.JSONDecodeError, TypeError):
                pass
    if "verified" in out:
        out["verified"] = bool(out["verified"])
    return out
