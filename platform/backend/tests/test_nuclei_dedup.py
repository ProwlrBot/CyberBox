from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services.tool_runner import _insert_nuclei_finding


class NucleiFindingDedupTest(unittest.TestCase):
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

        self.project_id = str(uuid.uuid4())
        self.campaign_id = str(uuid.uuid4())
        db.insert(
            "projects",
            {
                "id": self.project_id,
                "slug": self.project_id,
                "name": "Nuclei dedup test",
                "description": "",
                "created_at": "now",
            },
        )
        db.insert(
            "campaigns",
            {
                "id": self.campaign_id,
                "project_id": self.project_id,
                "name": "Nuclei campaign",
                "target_url": "https://example.test",
                "created_at": "now",
            },
        )

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _finding(self, template_id: str, matched_at: str) -> dict:
        return {
            "template-id": template_id,
            "matched-at": matched_at,
            "host": "https://example.test",
            "info": {
                "name": "Exposed test endpoint",
                "severity": "medium",
                "description": "A deterministic nuclei finding used for deduplication tests.",
            },
        }

    def test_same_finding_inserted_twice_creates_one_row(self) -> None:
        finding = self._finding("exposed-endpoint", "https://example.test/debug")

        _insert_nuclei_finding(finding, self.project_id, self.campaign_id)
        _insert_nuclei_finding(finding, self.project_id, self.campaign_id)

        row = db.query_one(
            "SELECT COUNT(*) AS count FROM vulnerabilities WHERE project_id=?",
            [self.project_id],
        )
        self.assertEqual(row["count"], 1)

    def test_distinct_findings_create_distinct_rows(self) -> None:
        first = self._finding("exposed-endpoint", "https://example.test/debug")
        second = self._finding("exposed-endpoint", "https://example.test/admin")

        _insert_nuclei_finding(first, self.project_id, self.campaign_id)
        _insert_nuclei_finding(second, self.project_id, self.campaign_id)

        row = db.query_one(
            "SELECT COUNT(*) AS count FROM vulnerabilities WHERE project_id=?",
            [self.project_id],
        )
        self.assertEqual(row["count"], 2)

    def test_stored_dedup_key_uses_nuclei_format(self) -> None:
        template_id = "exposed-endpoint"
        matched_at = "https://example.test/debug"

        _insert_nuclei_finding(
            self._finding(template_id, matched_at), self.project_id, self.campaign_id
        )

        row = db.query_one(
            "SELECT dedup_key FROM vulnerabilities WHERE project_id=?",
            [self.project_id],
        )
        self.assertEqual(row["dedup_key"], f"nuclei|{template_id}|{matched_at}")
