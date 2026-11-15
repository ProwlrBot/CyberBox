"""Notification channels: env-only secrets, severity filter, JSONL, best-effort delivery."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import notify


class NotifyTest(unittest.TestCase):
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

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()
        os.environ.pop("CBX_TEST_WEBHOOK", None)

    def test_create_rejects_unknown_kind(self) -> None:
        with self.assertRaises(ValueError):
            notify.create_channel("carrier_pigeon", "x")

    def test_jsonl_channel_writes_file(self) -> None:
        path = str(Path(self.temp.name) / "notes.jsonl")
        notify.create_channel("jsonl", "local log", config={"path": path})
        results = notify.send("test", "Hello", "body text", severity="high")
        self.assertEqual(results[0]["status"], "sent")
        lines = Path(path).read_text().strip().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0])["title"], "Hello")

    def test_discord_skips_when_env_unset(self) -> None:
        notify.create_channel("discord", "team", url_env="CBX_MISSING_ENV")
        results = notify.send("test", "t", "b")
        self.assertEqual(results[0]["status"], "skipped")
        self.assertIn("not set", results[0]["detail"])

    def test_min_severity_filter(self) -> None:
        path = str(Path(self.temp.name) / "f.jsonl")
        notify.create_channel("jsonl", "high only", config={"path": path, "min_severity": "high"})
        self.assertEqual(notify.send("x", "t", "b", severity="low")[0]["status"], "skipped")
        self.assertEqual(notify.send("x", "t", "b", severity="critical")[0]["status"], "sent")

    def test_disabled_channel_not_sent(self) -> None:
        ch = notify.create_channel("jsonl", "off", config={"path": str(Path(self.temp.name) / "x.jsonl")})
        notify.set_enabled(ch["id"], False)
        self.assertEqual(notify.send("x", "t", "b"), [])

    def test_url_configured_flag_reflects_env(self) -> None:
        notify.create_channel("discord", "team", url_env="CBX_TEST_WEBHOOK")
        self.assertFalse(notify.list_channels()[0]["url_configured"])
        os.environ["CBX_TEST_WEBHOOK"] = "https://example.test/hook"
        self.assertTrue(notify.list_channels()[0]["url_configured"])

    def test_log_records_attempts(self) -> None:
        notify.create_channel("jsonl", "l", config={"path": str(Path(self.temp.name) / "l.jsonl")})
        notify.send("evt", "t", "b")
        log = notify.recent_log()
        self.assertEqual(len(log), 1)
        self.assertEqual(log[0]["event"], "evt")


if __name__ == "__main__":
    unittest.main()
