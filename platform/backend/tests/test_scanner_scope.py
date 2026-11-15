"""Scanner full-scan scope gate: subfinder/httpx/nuclei must not run out of scope.

Covers audit gap #4 (run_full_scan was a policy-free execution surface). Asserts the
default-deny behavior of scanner._scope_filter directly.
"""
from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import profiles, scanner


class ScannerScopeTest(unittest.TestCase):
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
        profiles.seed()
        self.project_id = str(uuid.uuid4())
        db.insert("projects", {"id": self.project_id, "slug": self.project_id,
                               "name": "Test", "description": "", "created_at": "now"})
        self.scan_id = str(uuid.uuid4())
        db.insert("scans", {"id": self.scan_id, "project_id": self.project_id, "task_id": None,
                            "target": "example.com", "tool": "full", "status": "running",
                            "log": "", "stats": "{}", "created_at": "now"})

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _authorize(self) -> None:
        engagement_id = str(uuid.uuid4())
        db.insert("engagements", {
            "id": engagement_id, "project_id": self.project_id, "name": "Authorized",
            "profile_id": "bug-bounty", "autonomy": "balanced", "status": "active",
            "scope_version": 1, "budget": "{}", "policy": "{}", "starts_at": None,
            "ends_at": None, "created_by": None, "created_at": "now",
        })
        db.insert("scope_rules_v2", {
            "id": str(uuid.uuid4()), "engagement_id": engagement_id, "effect": "include",
            "resource_type": "domain", "pattern": "*.example.com", "ports": "[443]",
            "methods": '["GET"]', "max_requests_min": 60, "active": 1, "created_at": "now",
        })

    def test_no_engagement_blocks_everything(self) -> None:
        kept = scanner._scope_filter(self.project_id, ["api.example.com"], "passive", self.scan_id)
        self.assertEqual(kept, [])

    def test_in_scope_host_is_kept(self) -> None:
        self._authorize()
        kept = scanner._scope_filter(self.project_id, ["api.example.com"], "passive", self.scan_id)
        self.assertEqual(kept, ["api.example.com"])

    def test_out_of_scope_host_is_dropped(self) -> None:
        self._authorize()
        kept = scanner._scope_filter(self.project_id, ["evil.test"], "passive", self.scan_id)
        self.assertEqual(kept, [])

    def test_mixed_list_filters_to_in_scope_only(self) -> None:
        self._authorize()
        kept = scanner._scope_filter(
            self.project_id,
            ["api.example.com", "evil.test", "db.example.com"],
            "passive", self.scan_id,
        )
        self.assertEqual(sorted(kept), ["api.example.com", "db.example.com"])


if __name__ == "__main__":
    unittest.main()
