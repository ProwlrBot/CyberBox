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
    (3, "class_methodology.boundary — the one-line invariant two components disagree on (2026 boundary-differential pack)",
     ["ALTER TABLE class_methodology ADD COLUMN boundary TEXT"]),
    (4, "disclosure_techniques — the reusable technique/invariant a disclosed report teaches",
     ["CREATE TABLE IF NOT EXISTS disclosure_techniques ("
      " id TEXT PRIMARY KEY,"
      " disclosure_id TEXT NOT NULL REFERENCES disclosures(id) ON DELETE CASCADE,"
      " class_id TEXT REFERENCES taxonomy_classes(id),"
      " rank INTEGER NOT NULL DEFAULT 1,"
      " is_boundary INTEGER NOT NULL DEFAULT 0,"
      " confidence TEXT NOT NULL DEFAULT 'low',"
      " novelty INTEGER NOT NULL DEFAULT 0,"
      " signals TEXT NOT NULL DEFAULT '[]',"
      " status TEXT NOT NULL DEFAULT 'observed',"
      " extracted_at TEXT NOT NULL,"
      " UNIQUE (disclosure_id, class_id))",
      "CREATE INDEX IF NOT EXISTS idx_disc_tech_class ON disclosure_techniques(class_id)",
      "CREATE INDEX IF NOT EXISTS idx_disc_tech_disc ON disclosure_techniques(disclosure_id)"]),
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
