from __future__ import annotations

import gc
import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings


class CrashRecoveryTest(unittest.TestCase):
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

    def _insert_project(self, project_id: str | None = None) -> str:
        project_id = project_id or str(uuid.uuid4())
        db.insert(
            "projects",
            {
                "id": project_id,
                "slug": project_id,
                "name": "Crash recovery test",
                "description": "Committed test data",
                "created_at": "now",
            },
        )
        return project_id

    def _insert_task(self, project_id: str, task_id: str) -> None:
        db.insert(
            "tasks",
            {
                "id": task_id,
                "project_id": project_id,
                "name": f"Task {task_id}",
                "created_at": "now",
            },
        )

    def _reopen_without_close(self) -> None:
        abandoned = db._local.conn
        del db._local.conn
        del abandoned
        gc.collect()
        db.conn()

    def _integrity_check(self) -> str:
        result = db.query_one("PRAGMA integrity_check")
        self.assertIsNotNone(result)
        return next(iter(result.values()))

    def test_committed_rows_survive_simulated_crash(self) -> None:
        project_id = self._insert_project()
        task_ids = [str(uuid.uuid4()) for _ in range(5)]
        for task_id in task_ids:
            self._insert_task(project_id, task_id)
        db.conn().commit()

        self._reopen_without_close()

        self.assertEqual(db.query_one("SELECT id FROM projects WHERE id=?", [project_id])["id"], project_id)
        recovered = db.query(
            "SELECT id FROM tasks WHERE project_id=? ORDER BY id", [project_id]
        )
        self.assertEqual([row["id"] for row in recovered], sorted(task_ids))

    def test_integrity_check_is_ok_after_reopen(self) -> None:
        project_id = self._insert_project()
        self._insert_task(project_id, str(uuid.uuid4()))
        db.conn().commit()

        self._reopen_without_close()

        self.assertEqual(self._integrity_check(), "ok")

    def test_many_small_committed_writes_survive_reopen(self) -> None:
        project_id = self._insert_project()
        for index in range(200):
            self._insert_task(project_id, f"task-{index:03d}")

        self._reopen_without_close()

        self.assertEqual(self._integrity_check(), "ok")
        count = db.query_one("SELECT COUNT(*) AS count FROM tasks WHERE project_id=?", [project_id])
        self.assertEqual(count["count"], 200)

    def test_ensure_journal_mode_preserves_populated_database(self) -> None:
        project_id = self._insert_project()
        task_id = str(uuid.uuid4())
        self._insert_task(project_id, task_id)

        db._local.conn.close()
        del db._local.conn
        db.ensure_journal_mode()

        self.assertEqual(self._integrity_check(), "ok")
        self.assertEqual(db.query_one("SELECT id FROM projects WHERE id=?", [project_id])["id"], project_id)
        self.assertEqual(db.query_one("SELECT id FROM tasks WHERE id=?", [task_id])["id"], task_id)
