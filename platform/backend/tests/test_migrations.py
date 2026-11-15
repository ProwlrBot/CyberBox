from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from cyberbox import db, migrations
from cyberbox.config import Settings


class MigrationsTest(unittest.TestCase):
    def setUp(self) -> None:
        temp_root = "/dev/shm" if os.path.isdir("/dev/shm") else None
        self.temp = tempfile.TemporaryDirectory(dir=temp_root)

        settings = Settings(home=Path(self.temp.name))
        settings.ensure_dirs()
        import cyberbox.config as config

        config._settings = settings
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        db.init_db()

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _user_version(self) -> int:
        return db.query_one("PRAGMA user_version")["user_version"]

    def _campaign_columns(self) -> set[str]:
        return {row["name"] for row in db.query("PRAGMA table_info(campaigns)")}

    def test_migrate_sets_version_and_campaign_engagement_column(self) -> None:
        migrations.migrate()

        self.assertGreaterEqual(self._user_version(), 1)
        self.assertIn("engagement_id", self._campaign_columns())

    def test_migrate_is_idempotent(self) -> None:
        migrations.migrate()
        first_version = self._user_version()

        migrations.migrate()

        self.assertEqual(self._user_version(), first_version)

    def test_fresh_schema_duplicate_column_is_tolerated(self) -> None:
        self.assertEqual(self._user_version(), 0)
        self.assertIn("engagement_id", self._campaign_columns())

        migrations.migrate()

        self.assertGreaterEqual(self._user_version(), 1)
