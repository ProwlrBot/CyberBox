"""GitHub integration: diff/full scan, exit-code gate, SARIF, webhook HMAC, outbound guard."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import github, sarif


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True,
                   capture_output=True, text=True)


class GithubIntegrationTest(unittest.TestCase):
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
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        _git(self.repo, "init", "-q")
        _git(self.repo, "config", "user.email", "t@t.t")
        _git(self.repo, "config", "user.name", "t")
        (self.repo / "safe.py").write_text("x = 1\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base")

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _add_vuln_commit(self) -> None:
        (self.repo / "bad.py").write_text(
            'import os\nAWS="AKIAIOSFODNN7EXAMPLE"\nos.system("rm " + user)\n')
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "vuln")

    # --- full-tree scan ---------------------------------------------------
    def test_full_scan_finds_secret_and_shell_injection(self) -> None:
        self._add_vuln_commit()
        scan = github.scan_repository(str(self.repo), scope="full", fail_on="high")
        detectors = {f["detector"] for f in scan["findings"]}
        self.assertIn("Hardcoded AWS access key", detectors)
        self.assertIn("Shell injection sink", detectors)
        self.assertEqual(scan["exit_code"], 2)  # high findings -> gate fails

    def test_full_scan_clean_repo_passes(self) -> None:
        scan = github.scan_repository(str(self.repo), scope="full", fail_on="high")
        self.assertEqual(scan["exit_code"], 0)
        self.assertEqual(scan["summary"]["total"], 0)

    # --- diff-scoped scan -------------------------------------------------
    def test_diff_scan_only_sees_new_lines(self) -> None:
        self._add_vuln_commit()
        scan = github.scan_repository(str(self.repo), base="HEAD~1", scope="diff", fail_on="high")
        self.assertTrue(scan["findings"])
        self.assertTrue(all(f["file"] == "bad.py" for f in scan["findings"]))

    # --- exit-code threshold ---------------------------------------------
    def test_fail_on_critical_ignores_high(self) -> None:
        self._add_vuln_commit()
        scan = github.scan_repository(str(self.repo), scope="full", fail_on="critical")
        # AWS key + shell injection are 'high', below the 'critical' threshold -> pass
        self.assertEqual(scan["exit_code"], 0)
        self.assertGreater(scan["summary"]["total"], 0)  # still reported

    def test_private_key_is_critical_and_fails_critical_gate(self) -> None:
        (self.repo / "key.pem").write_text("-----BEGIN RSA PRIVATE KEY-----\nabc\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "key")
        scan = github.scan_repository(str(self.repo), scope="full", fail_on="critical")
        self.assertEqual(scan["exit_code"], 2)

    # --- SARIF ------------------------------------------------------------
    def test_sarif_structure(self) -> None:
        self._add_vuln_commit()
        scan = github.scan_repository(str(self.repo), scope="full")
        log = sarif.to_sarif(scan["findings"])
        self.assertEqual(log["version"], "2.1.0")
        run = log["runs"][0]
        self.assertEqual(run["tool"]["driver"]["name"], "CyberBox")
        self.assertTrue(run["tool"]["driver"]["rules"])
        self.assertEqual(len(run["results"]), len(scan["findings"]))
        self.assertIn("partialFingerprints", run["results"][0])

    # --- webhook HMAC -----------------------------------------------------
    def test_webhook_signature_valid_and_invalid(self) -> None:
        secret, body = "s3cr3t", b'{"x":1}'
        sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        self.assertTrue(github.verify_signature(secret, body, sig))
        self.assertFalse(github.verify_signature(secret, body, "sha256=deadbeef"))
        self.assertFalse(github.verify_signature(secret, body, None))
        self.assertFalse(github.verify_signature(None, body, sig))

    def test_pull_request_event_scans_local_checkout(self) -> None:
        self._add_vuln_commit()
        payload = {"number": 7, "repository": {"full_name": "o/r"},
                   "pull_request": {"head": {"sha": "abc"}, "base": {"ref": "main"}}}
        result = github.handle_pull_request_event(payload, local_path=str(self.repo))
        self.assertEqual(result["pr_number"], 7)
        self.assertEqual(result["trigger"], "webhook")

    def test_pull_request_event_without_checkout_queues(self) -> None:
        payload = {"number": 8, "repository": {"full_name": "o/r"},
                   "pull_request": {"head": {"sha": "abc"}, "base": {"ref": "main"}}}
        result = github.handle_pull_request_event(payload)
        self.assertEqual(result["status"], "queued")

    # --- outbound guard ---------------------------------------------------
    def test_post_results_dry_run_by_default(self) -> None:
        scan = github.scan_repository(str(self.repo), scope="full")
        out = github.post_results(scan["id"])  # confirm defaults to False
        self.assertFalse(out["posted"])
        self.assertTrue(out["dry_run"])
        self.assertIn("body", out)

    def test_post_results_confirm_without_token_does_not_post(self) -> None:
        self._add_vuln_commit()
        scan = github.scan_repository(str(self.repo), scope="full", pr_number=3)
        os.environ.pop("GITHUB_TOKEN", None)
        out = github.post_results(scan["id"], confirm=True)
        self.assertFalse(out["posted"])
        self.assertIn("no token", out["reason"])


if __name__ == "__main__":
    unittest.main()
