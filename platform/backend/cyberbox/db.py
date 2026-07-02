"""SQLite access layer (WAL mode)."""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

from .config import get_settings

_local = threading.local()
_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().db_path, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = _connect()
        _local.conn = c
    return c


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
