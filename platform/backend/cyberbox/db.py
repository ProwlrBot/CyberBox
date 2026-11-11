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
    # Serialize initial connections (journal-mode conversion needs an exclusive lock).
    # Journal mode + synchronous are env-aware (config): WAL+NORMAL on a real FS (durable
    # and fast), DELETE+NORMAL on WSL2 (WAL's mmap SHM hangs there). Never synchronous=OFF.
    s = get_settings()
    with _lock:
        c = sqlite3.connect(s.db_path, check_same_thread=False, timeout=60)
        c.row_factory = sqlite3.Row
        c.execute(f"PRAGMA journal_mode = {s.db_journal_mode}")
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA busy_timeout = 15000")
        c.execute(f"PRAGMA synchronous = {s.db_synchronous}")
        return c


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = _connect()
        _local.conn = c
    return c


def ensure_journal_mode() -> None:
    """Bring the DB to the configured journal mode before uvicorn spawns threads.

    WAL (or other) target: a plain PRAGMA sets it, non-destructively.
    DELETE target on a DB currently in WAL (WSL2): migrate via the backup() API to avoid
    the mmap/SHM hang. Guarded by a cross-process lock, verified with integrity_check, and
    non-destructive — the original is copied to <db>.pre_migrate.bak before replacement and
    stale WAL/SHM are removed only after their committed content is confirmed in the new DB.
    """
    import os
    import fcntl
    import shutil
    s = get_settings()
    db_path = str(s.db_path)
    target = s.db_journal_mode.lower()

    lock_path = db_path + ".migrate.lock"
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        has_wal = os.path.exists(db_path + "-wal")

        c = sqlite3.connect(db_path, timeout=30)
        try:
            current = c.execute("PRAGMA journal_mode").fetchone()[0].lower()
            if target != "delete":
                new = c.execute(f"PRAGMA journal_mode = {s.db_journal_mode}").fetchone()[0].lower()
                c.execute(f"PRAGMA synchronous = {s.db_synchronous}")
                if new != target:
                    raise RuntimeError(f"could not set journal_mode={target}, got {new}")
                return
            if current == "delete" and not has_wal:
                return  # already in the target state
        finally:
            c.close()

        # target == delete but DB is in WAL (or a stale WAL exists): migrate via backup().
        tmp_path = db_path + ".migrate_tmp"
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        src = sqlite3.connect(db_path, timeout=30, isolation_level=None)
        src.execute("PRAGMA busy_timeout = 10000")
        try:
            src.execute("PRAGMA wal_checkpoint(PASSIVE)")  # fold committed frames in if possible
        except sqlite3.OperationalError:
            pass  # may fail on WSL2 SHM; backup() still copies committed WAL content
        dst = sqlite3.connect(tmp_path, isolation_level=None)
        src.backup(dst)
        src.close()
        dst.execute("PRAGMA journal_mode = DELETE")
        dst.execute(f"PRAGMA synchronous = {s.db_synchronous}")
        integ = dst.execute("PRAGMA integrity_check").fetchone()[0]
        dst.close()
        for ext in ["-wal", "-shm"]:
            p = tmp_path + ext
            if os.path.exists(p):
                os.unlink(p)
        if integ != "ok":
            os.unlink(tmp_path)
            raise RuntimeError(f"migrated DB failed integrity_check: {integ!r}")

        shutil.copy2(db_path, db_path + ".pre_migrate.bak")  # keep a recoverable original
        shutil.move(tmp_path, db_path)
        for ext in ["-wal", "-shm"]:
            p = db_path + ext
            if os.path.exists(p):
                os.unlink(p)
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


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
    "allowed_methods", "permissions", "reference_urls", "files_changed",
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
