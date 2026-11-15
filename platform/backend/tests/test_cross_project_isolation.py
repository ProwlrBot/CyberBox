from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings


class CrossProjectIsolationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(dir="/dev/shm" if os.path.isdir("/dev/shm") else None)
        settings = Settings(home=Path(self.temp.name))
        settings.ensure_dirs()
        import cyberbox.config as config

        config._settings = settings
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        db.init_db()

        self.project_a = "project-a"
        self.project_b = "project-b"
        for project_id, name in (
            (self.project_a, "Project A"),
            (self.project_b, "Project B"),
        ):
            db.insert(
                "projects",
                {
                    "id": project_id,
                    "slug": project_id,
                    "name": name,
                    "description": "",
                    "created_at": "now",
                },
            )

        self.asset_ids = {
            self.project_a: {"asset-a-1", "asset-a-2"},
            self.project_b: {"asset-b-1"},
        }
        for project_id, asset_ids in self.asset_ids.items():
            for asset_id in asset_ids:
                db.insert(
                    "assets",
                    {
                        "id": asset_id,
                        "project_id": project_id,
                        "host": f"{asset_id}.example.test",
                        "first_seen": "now",
                        "last_seen": "now",
                    },
                )

        self.vulnerability_ids = {
            self.project_a: {"vulnerability-a-1"},
            self.project_b: {"vulnerability-b-1", "vulnerability-b-2"},
        }
        for project_id, vulnerability_ids in self.vulnerability_ids.items():
            for vulnerability_id in vulnerability_ids:
                db.insert(
                    "vulnerabilities",
                    {
                        "id": vulnerability_id,
                        "project_id": project_id,
                        "name": f"Finding {vulnerability_id}",
                        "dedup_key": vulnerability_id,
                        "detected_at": "now",
                    },
                )

        self.execution_ids = {
            self.project_a: {"execution-a-1", "execution-a-2"},
            self.project_b: {"execution-b-1"},
        }
        for project_id, execution_ids in self.execution_ids.items():
            for execution_id in execution_ids:
                db.insert(
                    "executions",
                    {
                        "id": execution_id,
                        "project_id": project_id,
                        "kind": "isolation-test",
                        "idempotency_key": execution_id,
                        "created_at": "now",
                    },
                )

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _assert_table_isolated(self, table: str, expected: dict[str, set[str]]) -> None:
        for project_id in (self.project_a, self.project_b):
            rows = db.query(
                f"SELECT id, project_id FROM {table} WHERE project_id=?",
                [project_id],
            )
            self.assertEqual(len(rows), len(expected[project_id]))
            self.assertEqual({row["id"] for row in rows}, expected[project_id])
            self.assertEqual({row["project_id"] for row in rows}, {project_id})

    def test_assets_are_isolated_by_project(self) -> None:
        self._assert_table_isolated("assets", self.asset_ids)

    def test_vulnerabilities_are_isolated_by_project(self) -> None:
        self._assert_table_isolated("vulnerabilities", self.vulnerability_ids)

    def test_executions_are_isolated_by_project(self) -> None:
        self._assert_table_isolated("executions", self.execution_ids)
