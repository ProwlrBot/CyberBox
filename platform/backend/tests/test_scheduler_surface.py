"""Scheduler (recurring jobs, leasing, reschedule) + attack-surface snapshot/drift."""
from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import scheduler, surface


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SchedulerSurfaceTest(unittest.TestCase):
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

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _asset(self, host: str) -> None:
        db.insert("assets", {"id": str(uuid.uuid4()), "project_id": self.project_id,
                             "host": host, "first_seen": _now(), "last_seen": _now()})

    # --- surface snapshot / drift ----------------------------------------
    def test_first_drift_has_no_comparison(self) -> None:
        self._asset("a.example.com")
        surface.snapshot(self.project_id)
        d = surface.drift(self.project_id)
        self.assertFalse(d["compared"])
        self.assertEqual(d["current_count"], 1)

    def test_drift_detects_added_and_removed_hosts(self) -> None:
        self._asset("a.example.com")
        surface.snapshot(self.project_id)
        # host b appears, host a removed
        db.execute("DELETE FROM assets WHERE host='a.example.com'")
        self._asset("b.example.com")
        d = surface.snapshot_and_drift(self.project_id)
        self.assertTrue(d["compared"])
        self.assertEqual(len(d["added"]), 1)
        self.assertEqual(len(d["removed"]), 1)
        self.assertIn("b.example.com", d["added"][0])
        self.assertIn("a.example.com", d["removed"][0])

    # --- scheduler --------------------------------------------------------
    def test_create_job_rejects_short_interval(self) -> None:
        with self.assertRaises(ValueError):
            scheduler.create_job("surface_rescan", 10, project_id=self.project_id)

    def test_create_job_rejects_unknown_kind(self) -> None:
        with self.assertRaises(ValueError):
            scheduler.create_job("mine_bitcoin", 60)

    def test_due_job_runs_and_reschedules(self) -> None:
        self._asset("a.example.com")
        job = scheduler.create_job("surface_rescan", 3600, project_id=self.project_id)
        results = scheduler.run_due()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["status"], "ok")
        after = scheduler.get_job(job["id"])
        self.assertEqual(after["last_status"], "ok")
        self.assertGreater(after["next_run_at"], job["next_run_at"])  # pushed forward

    def test_not_due_job_does_not_run(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        scheduler.create_job("surface_rescan", 3600, project_id=self.project_id,
                             first_run_at=future)
        self.assertEqual(scheduler.run_due(), [])

    def test_disabled_job_does_not_run(self) -> None:
        job = scheduler.create_job("surface_rescan", 3600, project_id=self.project_id)
        scheduler.set_enabled(job["id"], False)
        self.assertEqual(scheduler.run_due(), [])

    def test_job_error_is_recorded_not_raised(self) -> None:
        # github_scan with no repo in spec -> _execute raises -> recorded as error
        job = scheduler.create_job("github_scan", 3600, spec={}, project_id=self.project_id)
        results = scheduler.run_due()
        self.assertEqual(results[0]["status"], "error")
        self.assertEqual(scheduler.get_job(job["id"])["last_status"], "error")


if __name__ == "__main__":
    unittest.main()
