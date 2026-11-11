"""Additive, forward-only schema migrations keyed on PRAGMA user_version.

schema.sql (CREATE TABLE IF NOT EXISTS) builds fresh databases. It cannot ALTER an
existing table, so column additions to tables that already exist go here. Each migration
is applied in one transaction and bumps user_version; a failure rolls the whole step back.
New installs get the column from schema.sql AND skip the migration (it's duplicate-column
tolerant), so both paths converge on the same shape.
"""
from __future__ import annotations

import sqlite3

from . import db

# (version, description, [SQL statements]). After applying version N, user_version == N.
MIGRATIONS: list[tuple[int, str, list[str]]] = [
    (1, "campaigns.engagement_id — bind autonomous runs to an authorization for policy",
     ["ALTER TABLE campaigns ADD COLUMN engagement_id TEXT REFERENCES engagements(id)"]),
    (2, "finding_reviews.reviewer_id — identify the reviewer to enforce finder != validator",
     ["ALTER TABLE finding_reviews ADD COLUMN reviewer_id TEXT"]),
]


def migrate() -> None:
    """Apply pending migrations. Idempotent; call once at startup after init_db()."""
    with db._lock:
        c = db.conn()
        version = c.execute("PRAGMA user_version").fetchone()[0]
        for ver, _desc, statements in MIGRATIONS:
            if ver <= version:
                continue
            try:
                for stmt in statements:
                    try:
                        c.execute(stmt)
                    except sqlite3.OperationalError as exc:
                        # Tolerate a column a fresh schema.sql already created.
                        if "duplicate column" not in str(exc).lower():
                            raise
                c.execute(f"PRAGMA user_version = {ver}")
                c.commit()
            except Exception:
                c.rollback()
                raise
