"""Tests for the Raptor source scanner integration."""
from __future__ import annotations

import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import profiles, playbooks, project_templates
from cyberbox.services.scanner import RAPTOR_PROTOCOLS, run_raptor_scan


FIXTURE_JSONL = "\n".join([
    json.dumps({"template-id": "php-rce-001", "info": {"name": "PHP RCE", "severity": "critical"}, "matched-at": "/src/shell.php"}),
    json.dumps({"template-id": "sqli-002", "info": {"name": "SQLi", "severity": "high"}, "matched-at": "/src/db.php"}),
    "not-json-line",
    json.dumps({"template-id": "xss-003", "info": {"name": "XSS", "severity": "medium"}, "matched-at": "/src/view.php"}),
])


class RaptorScanTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
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
        playbooks.seed()
        project_templates.seed()
        self.project_id = str(uuid.uuid4())
        self.user_id = str(uuid.uuid4())
        db.insert("users", {"id": self.user_id, "email": f"{self.user_id}@test.local",
                            "name": "Tester", "role": "admin", "api_key": f"cbx_{self.user_id}",
                            "created_at": "now"})
        db.insert("projects", {"id": self.project_id, "slug": self.project_id,
                               "name": "Test", "description": "", "created_at": "now"})
        self.engagement_id = str(uuid.uuid4())
        db.insert("engagements", {
            "id": self.engagement_id, "project_id": self.project_id, "name": "Auth",
            "profile_id": "bug-bounty", "autonomy": "balanced", "status": "authorized",
            "scope_version": 1, "budget": "{}", "policy": "{}", "starts_at": None,
            "ends_at": None, "created_by": None, "created_at": "now",
        })

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def test_protocols_constant_has_thirteen_entries(self) -> None:
        self.assertEqual(len(RAPTOR_PROTOCOLS), 13)
        self.assertIn("php", RAPTOR_PROTOCOLS)
        self.assertIn("mcp", RAPTOR_PROTOCOLS)

    def test_invalid_protocol_raises(self) -> None:
        with self.assertRaises(ValueError, msg="unknown raptor protocol"):
            run_raptor_scan(self.project_id, self.engagement_id, "notaprotocol",
                            "/tmp/fake", self.user_id)

    def test_missing_binary_raises(self) -> None:
        with patch("cyberbox.services.scanner.shutil.which", return_value=None):
            with self.assertRaises(RuntimeError, msg="raptor binary not found"):
                run_raptor_scan(self.project_id, self.engagement_id, "php",
                                "/tmp/fake", self.user_id)

    def test_unauthorized_engagement_raises(self) -> None:
        blocked_id = str(uuid.uuid4())
        db.insert("engagements", {
            "id": blocked_id, "project_id": self.project_id, "name": "Blocked",
            "profile_id": "bug-bounty", "autonomy": "balanced",
            "status": "authorization-pending",
            "scope_version": 1, "budget": "{}", "policy": "{}", "starts_at": None,
            "ends_at": None, "created_by": None, "created_at": "now",
        })
        with patch("cyberbox.services.scanner.shutil.which", return_value="/usr/bin/raptor"):
            with self.assertRaises(PermissionError, msg="raptor scan blocked"):
                run_raptor_scan(self.project_id, blocked_id, "php",
                                "/tmp/fake", self.user_id)

    def test_parses_jsonl_output_correctly(self) -> None:
        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_proc.stdout = FIXTURE_JSONL
        mock_proc.stderr = ""

        with patch("cyberbox.services.scanner.shutil.which", return_value="/usr/bin/raptor"), \
             patch("cyberbox.services.scanner.subprocess.run", return_value=mock_proc):
            result = run_raptor_scan(self.project_id, self.engagement_id, "php",
                                     "/tmp/fake", self.user_id)

        # 3 valid JSON lines, 1 non-JSON line
        self.assertEqual(result["findings_count"], 3)
        self.assertIn("execution_id", result)
        self.assertLessEqual(len(result["output_lines"]), 50)
        # execution record created and marked done
        exec_row = db.query_one("SELECT * FROM executions WHERE id=?", [result["execution_id"]])
        self.assertIsNotNone(exec_row)
        self.assertEqual(exec_row["status"], "done")
        self.assertEqual(exec_row["kind"], "raptor.scan")

    def test_timeout_returns_zero_findings(self) -> None:
        import subprocess as _sp

        with patch("cyberbox.services.scanner.shutil.which", return_value="/usr/bin/raptor"), \
             patch("cyberbox.services.scanner.subprocess.run",
                   side_effect=_sp.TimeoutExpired(["raptor"], 300)):
            result = run_raptor_scan(self.project_id, self.engagement_id, "js",
                                     "/tmp/fake", self.user_id)

        self.assertEqual(result["findings_count"], 0)
        exec_row = db.query_one("SELECT * FROM executions WHERE id=?", [result["execution_id"]])
        self.assertEqual(exec_row["status"], "failed")
        self.assertIn("timed out", exec_row["error"])


if __name__ == "__main__":
    unittest.main()
