"""Tool-runner policy gate: the autonomous path must never reach a live tool unscoped.

Covers audit gap #2 (campaign/tool_runner bypass) and #4 (shared enforcement). These
assert the default-deny invariant directly on tool_runner._policy_gate.
"""
from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db, migrations
from cyberbox.config import Settings
from cyberbox.services import profiles, tool_registry, tool_runner


class PolicyGateTest(unittest.TestCase):
    def setUp(self) -> None:
        # tmpfs keeps NORMAL-mode fsyncs cheap so the suite stays fast
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
        migrations.migrate()
        profiles.seed()
        tool_registry.seed()
        self.project_id = str(uuid.uuid4())
        db.insert("projects", {"id": self.project_id, "slug": self.project_id,
                               "name": "Test", "description": "", "created_at": "now"})

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _authorized_engagement(self, autonomy: str = "balanced") -> str:
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

    # ── default-deny ──────────────────────────────────────────────────────────

    def test_no_engagement_is_denied(self) -> None:
        gate = tool_runner._policy_gate(None, "nuclei", {"domain": "api.example.com"})
        self.assertFalse(gate["allowed"])
        self.assertIn("no engagement", gate["reason"])

    def test_no_target_is_denied(self) -> None:
        eng = self._authorized_engagement()
        gate = tool_runner._policy_gate(eng, "nuclei", {})
        self.assertFalse(gate["allowed"])
        self.assertIn("no resolvable target", gate["reason"])

    def test_out_of_scope_target_is_denied(self) -> None:
        eng = self._authorized_engagement()
        gate = tool_runner._policy_gate(eng, "subfinder", {"domain": "evil.test"})
        self.assertFalse(gate["allowed"])

    def test_nonexistent_engagement_is_denied(self) -> None:
        gate = tool_runner._policy_gate("does-not-exist", "subfinder",
                                        {"domain": "api.example.com"})
        self.assertFalse(gate["allowed"])

    # ── authorized path still works ───────────────────────────────────────────

    def test_in_scope_passive_tool_is_allowed(self) -> None:
        eng = self._authorized_engagement()
        gate = tool_runner._policy_gate(eng, "subfinder", {"domain": "api.example.com"})
        self.assertTrue(gate["allowed"], gate["reason"])

    def test_state_changing_tool_needs_approval_under_balanced(self) -> None:
        eng = self._authorized_engagement(autonomy="balanced")
        gate = tool_runner._policy_gate(eng, "nuclei", {"domain": "api.example.com"})
        self.assertFalse(gate["allowed"])
        self.assertIn("approval", gate["reason"])

    def test_state_changing_tool_allowed_under_autonomous(self) -> None:
        eng = self._authorized_engagement(autonomy="autonomous")
        gate = tool_runner._policy_gate(eng, "nuclei", {"domain": "api.example.com"})
        self.assertTrue(gate["allowed"], gate["reason"])

    # ── helpers ───────────────────────────────────────────────────────────────

    def test_target_url_resolution(self) -> None:
        self.assertEqual(tool_runner._target_url({"target_url": "https://x.example.com"}),
                         "https://x.example.com")
        self.assertEqual(tool_runner._target_url({"domain": "x.example.com"}),
                         "https://x.example.com")
        self.assertIsNone(tool_runner._target_url({}))

    def test_migration_added_engagement_column(self) -> None:
        cols = [r["name"] for r in db.query("PRAGMA table_info(campaigns)")]
        self.assertIn("engagement_id", cols)
        version = db.query_one("PRAGMA user_version")
        self.assertGreaterEqual(list(version.values())[0], 1)


if __name__ == "__main__":
    unittest.main()
