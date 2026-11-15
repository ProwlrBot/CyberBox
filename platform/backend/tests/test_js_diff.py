from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import js_diff


class JsDiffTest(unittest.TestCase):
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
        db.insert("projects", {"id": self.project_id, "slug": self.project_id,
                               "name": "JS test", "description": "", "created_at": "now"})

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def test_extract_endpoints_finds_api_paths_and_fetch_targets(self) -> None:
        js = 'const a="/api/v2/users";fetch("/internal/admin/export");var x="/static/app.js";'
        eps = js_diff.extract_endpoints(js)
        self.assertIn("/api/v2/users", eps)
        self.assertIn("/internal/admin/export", eps)

    def test_extract_secrets_redacts_and_classifies(self) -> None:
        js = 'var k="AKIAIOSFODNN7EXAMPLE";const t="ghp_' + "a" * 36 + '";'
        secrets = js_diff.extract_secrets(js)
        kinds = {s["kind"] for s in secrets}
        self.assertIn("aws_access_key", kinds)
        self.assertIn("github_token", kinds)
        aws = next(s for s in secrets if s["kind"] == "aws_access_key")
        self.assertIn("…", aws["match"])  # redacted middle

    def test_snapshot_stores_once_and_dedups_unchanged(self) -> None:
        content = 'fetch("/api/v1/me");'
        first = js_diff.snapshot(self.project_id, "https://t/app.js", content=content)
        self.assertTrue(first["changed"])
        again = js_diff.snapshot(self.project_id, "https://t/app.js", content=content)
        self.assertFalse(again["changed"])  # same hash -> no new revision
        rows = db.query("SELECT id FROM js_snapshots WHERE project_id=?", [self.project_id])
        self.assertEqual(len(rows), 1)

    def test_diff_surfaces_newly_added_endpoint(self) -> None:
        js_diff.snapshot(self.project_id, "https://t/app.js", content='fetch("/api/v1/me");')
        js_diff.snapshot(self.project_id, "https://t/app.js",
                         content='fetch("/api/v1/me");fetch("/api/v1/admin/wipe");')
        d = js_diff.diff(self.project_id, "https://t/app.js")
        self.assertIn("/api/v1/admin/wipe", d["added_endpoints"])
        self.assertNotIn("/api/v1/me", d["added_endpoints"])  # unchanged, not "added"
        self.assertTrue(d["unified_diff"])

    def test_diff_requires_two_revisions(self) -> None:
        js_diff.snapshot(self.project_id, "https://t/app.js", content='fetch("/a");')
        with self.assertRaises(ValueError):
            js_diff.diff(self.project_id, "https://t/app.js")

    def test_diff_flags_newly_added_secret(self) -> None:
        js_diff.snapshot(self.project_id, "https://t/app.js", content='var x=1;')
        js_diff.snapshot(self.project_id, "https://t/app.js",
                         content='var x=1;var k="AKIAIOSFODNN7EXAMPLE";')
        d = js_diff.diff(self.project_id, "https://t/app.js")
        self.assertTrue(any(s["kind"] == "aws_access_key" for s in d["added_secrets"]))


if __name__ == "__main__":
    unittest.main()
