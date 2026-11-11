"""policy.filter_scope — the default-deny batch scope gate used by the nuclei-sweep
endpoint (previously an ungated live-scanner surface)."""
from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import policy, profiles


class PolicyScopeGateTest(unittest.TestCase):
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

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _authorize(self, autonomy: str = "autonomous") -> str:
        engagement_id = str(uuid.uuid4())
        db.insert("engagements", {
            "id": engagement_id, "project_id": self.project_id, "name": "Authorized",
            "profile_id": "bug-bounty", "autonomy": autonomy, "status": "active",
            "scope_version": 1, "budget": "{}", "policy": "{}", "starts_at": None,
            "ends_at": None, "created_by": None, "created_at": "now",
        })
        db.insert("scope_rules_v2", {
            "id": str(uuid.uuid4()), "engagement_id": engagement_id, "effect": "include",
            "resource_type": "domain", "pattern": "*.example.com", "ports": "[443]",
            "methods": '["GET"]', "max_requests_min": 60, "active": 1, "created_at": "now",
        })
        return engagement_id

    def test_no_engagement_blocks_all(self) -> None:
        gate = policy.filter_scope(self.project_id, ["api.example.com", "db.example.com"],
                                   risk_class="state-changing")
        self.assertIsNone(gate["engagement_id"])
        self.assertEqual(gate["allowed"], [])
        self.assertEqual(len(gate["blocked"]), 2)
        self.assertEqual(gate["blocked"][0]["reason"], "no authorized engagement")

    def test_in_scope_allowed(self) -> None:
        eid = self._authorize()
        gate = policy.filter_scope(self.project_id, ["api.example.com"],
                                   risk_class="state-changing")
        self.assertEqual(gate["engagement_id"], eid)
        self.assertEqual(gate["allowed"], ["api.example.com"])
        self.assertEqual(gate["blocked"], [])

    def test_mixed_filters_to_in_scope(self) -> None:
        self._authorize()
        gate = policy.filter_scope(
            self.project_id, ["api.example.com", "evil.test", "db.example.com"],
            risk_class="state-changing")
        self.assertEqual(sorted(gate["allowed"]), ["api.example.com", "db.example.com"])
        self.assertEqual([b["target"] for b in gate["blocked"]], ["evil.test"])

    def test_approval_required_is_blocked_on_sync_path(self) -> None:
        # balanced autonomy auto-allows only up to low-impact; state-changing needs approval,
        # and this synchronous gate treats approval-required as blocked.
        self._authorize(autonomy="balanced")
        gate = policy.filter_scope(self.project_id, ["api.example.com"],
                                   risk_class="state-changing")
        self.assertEqual(gate["allowed"], [])
        self.assertEqual(len(gate["blocked"]), 1)

    def test_authorized_engagement_none_without_active(self) -> None:
        self.assertIsNone(policy.authorized_engagement(self.project_id))


if __name__ == "__main__":
    unittest.main()
