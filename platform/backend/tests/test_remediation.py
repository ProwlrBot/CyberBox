"""Remediation service — per-finding guidance, deterministic suggested fixes, patch."""
from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import remediation


def _now() -> str:
    return "now"


class RemediationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(dir="/dev/shm" if os.path.isdir("/dev/shm") else None)
        self.base = Path(self.temp.name)
        settings = Settings(home=self.base / "home")
        settings.ensure_dirs()
        import cyberbox.config as config
        config._settings = settings
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        db.init_db()
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.scan_id = str(uuid.uuid4())
        db.insert("github_scans", {
            "id": self.scan_id, "source_id": None, "execution_id": None,
            "repo": str(self.repo), "revision": "abc", "base_revision": None,
            "pr_number": None, "trigger": "manual", "scope": "full", "status": "completed",
            "fail_on": "high", "exit_code": 2, "summary": "{}", "created_at": _now(),
            "finished_at": _now()})

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _finding(self, detector: str, severity: str, file: str, line: int, snippet: str) -> None:
        db.insert("code_findings", {
            "id": str(uuid.uuid4()), "scan_id": self.scan_id, "source_id": None,
            "revision": "abc", "rule_id": "cyberbox.x", "detector": detector,
            "severity": severity, "file": file, "line": line,
            "message": f"{detector}", "snippet": snippet,
            "fingerprint": uuid.uuid4().hex[:32], "status": "open", "created_at": _now()})

    # --- deterministic transforms ----------------------------------------
    def test_tls_transform(self) -> None:
        p = remediation.plan_for_finding(
            {"id": "1", "detector": "Disabled TLS verification", "severity": "medium",
             "file": "a.py", "line": 3, "snippet": "requests.get(url, verify=False)"})
        self.assertTrue(p["auto_fixable"])
        self.assertIn("verify=True", p["suggested_line"])
        self.assertEqual(p["cwe"], "CWE-295")

    def test_yaml_transform(self) -> None:
        p = remediation.plan_for_finding(
            {"id": "1", "detector": "Insecure deserialization", "severity": "high",
             "file": "a.py", "line": 1, "snippet": "data = yaml.load(f)"})
        self.assertEqual(p["suggested_line"], "data = yaml.safe_load(f)")

    def test_secret_to_env(self) -> None:
        p = remediation.plan_for_finding(
            {"id": "1", "detector": "Hardcoded generic secret", "severity": "high",
             "file": "a.py", "line": 1, "snippet": 'API_KEY = "supersecretvalue123"'})
        self.assertEqual(p["suggested_line"], 'API_KEY = os.environ["API_KEY"]')

    def test_non_fixable_is_guidance_only(self) -> None:
        p = remediation.plan_for_finding(
            {"id": "1", "detector": "Use of eval()", "severity": "high",
             "file": "a.py", "line": 1, "snippet": "eval(user_input)"})
        self.assertFalse(p["auto_fixable"])
        self.assertIsNone(p["suggested_line"])
        self.assertIn("ast.literal_eval", p["guidance"])

    # --- plan + patch over real files ------------------------------------
    def test_build_plan_counts(self) -> None:
        self._finding("Disabled TLS verification", "medium", "net.py", 2, "s = requests.get(u, verify=False)")
        self._finding("Use of eval()", "high", "run.py", 5, "eval(x)")
        plan = remediation.build_plan(self.scan_id)
        self.assertEqual(plan["total"], 2)
        self.assertEqual(plan["auto_fixable"], 1)

    def test_unified_diff_applies_only_safe_fixes(self) -> None:
        (self.repo / "net.py").write_text(
            "import requests\ndef go(u):\n    return requests.get(u, verify=False)\n")
        self._finding("Disabled TLS verification", "medium", "net.py", 3,
                      "    return requests.get(u, verify=False)")
        patch = remediation.unified_diff(self.scan_id)
        self.assertIn("a/net.py", patch)
        self.assertIn("-    return requests.get(u, verify=False)", patch)
        self.assertIn("+    return requests.get(u, verify=True)", patch)

    def test_patch_preserves_indentation_when_snippet_stripped(self) -> None:
        # github.py stores a STRIPPED snippet; the patch must still preserve the real
        # file line's indentation (regression: it rewrote to a de-indented line).
        (self.repo / "net.py").write_text(
            "class C:\n    def go(self, u):\n        return requests.get(u, verify=False)\n")
        self._finding("Disabled TLS verification", "medium", "net.py", 3,
                      "return requests.get(u, verify=False)")  # stripped, no indent
        patch = remediation.unified_diff(self.scan_id)
        self.assertIn("+        return requests.get(u, verify=True)", patch)
        self.assertNotIn("+return requests.get(u, verify=True)", patch)

    def test_patch_skips_stale_line(self) -> None:
        # Finding points at a line that no longer contains the pattern -> no edit.
        (self.repo / "net.py").write_text("x = 1\ny = 2\nz = 3\n")
        self._finding("Disabled TLS verification", "medium", "net.py", 2, "verify=False")
        self.assertEqual(remediation.unified_diff(self.scan_id), "")

    def test_unified_diff_empty_when_nothing_fixable(self) -> None:
        self._finding("Use of eval()", "high", "run.py", 1, "eval(x)")
        self.assertEqual(remediation.unified_diff(self.scan_id), "")

    def test_build_plan_unknown_scan_raises(self) -> None:
        with self.assertRaises(ValueError):
            remediation.build_plan("nope")


if __name__ == "__main__":
    unittest.main()
