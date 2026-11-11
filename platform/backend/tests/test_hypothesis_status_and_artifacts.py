"""New wiring: hypothesis status transitions + artifact list/download backing."""
from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import artifacts, research


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class HypothesisAndArtifactTest(unittest.TestCase):
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
        self.project_id = str(uuid.uuid4())
        db.insert("projects", {"id": self.project_id, "slug": f"p-{self.project_id[:8]}",
                               "name": "P", "created_at": _now()})
        db.insert("profiles", {"id": "bug-bounty", "name": "BB", "version": "1",
                               "manifest": "{}", "created_at": _now()})
        self.engagement_id = str(uuid.uuid4())
        db.insert("engagements", {"id": self.engagement_id, "project_id": self.project_id,
                                  "name": "E", "profile_id": "bug-bounty", "created_at": _now()})

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _hypothesis(self, status: str = "proposed") -> str:
        hid = str(uuid.uuid4())
        db.insert("hypotheses", {
            "id": hid, "project_id": self.project_id, "engagement_id": self.engagement_id,
            "asset_id": None, "title": "t", "claim": "c", "status": status,
            "confidence": "low", "created_by": None,
            "created_at": _now(), "updated_at": "2000-01-01T00:00:00+00:00"})
        return hid

    # --- hypothesis status -------------------------------------------------
    def test_update_status_moves_to_active(self) -> None:
        hid = self._hypothesis()
        updated = research.update_hypothesis_status(self.project_id, hid, "active")
        self.assertEqual(updated["status"], "active")
        self.assertNotEqual(updated["updated_at"], "2000-01-01T00:00:00+00:00")

    def test_invalid_status_rejected(self) -> None:
        hid = self._hypothesis()
        with self.assertRaises(ValueError):
            research.update_hypothesis_status(self.project_id, hid, "bogus")

    def test_unknown_hypothesis_rejected(self) -> None:
        with self.assertRaises(ValueError):
            research.update_hypothesis_status(self.project_id, "nope", "active")

    def test_wrong_project_rejected(self) -> None:
        hid = self._hypothesis()
        with self.assertRaises(ValueError):
            research.update_hypothesis_status("other-project", hid, "active")

    # --- artifacts ---------------------------------------------------------
    def test_list_and_read_roundtrip(self) -> None:
        stored = artifacts.store(self.project_id, "scan-log", b"hello evidence", "text/plain")
        listed = artifacts.list_for_project(self.project_id)
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["id"], stored["id"])
        self.assertEqual(listed[0]["size"], len(b"hello evidence"))
        result = artifacts.read(stored["id"])
        self.assertIsNotNone(result)
        meta, content = result
        self.assertEqual(content, b"hello evidence")
        self.assertEqual(meta["kind"], "scan-log")

    def test_list_scoped_to_project(self) -> None:
        artifacts.store(self.project_id, "k", b"a", "text/plain")
        other = str(uuid.uuid4())
        db.insert("projects", {"id": other, "slug": f"o-{other[:8]}", "name": "O", "created_at": _now()})
        artifacts.store(other, "k", b"b", "text/plain")
        self.assertEqual(len(artifacts.list_for_project(self.project_id)), 1)
        self.assertEqual(len(artifacts.list_for_project(other)), 1)


if __name__ == "__main__":
    unittest.main()
