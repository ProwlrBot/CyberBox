from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import screenshots
from cyberbox.services.fingerprint import ProbeBlocked


class ScreenshotsTest(unittest.TestCase):
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
                               "name": "Shot test", "description": "", "created_at": "now"})

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def test_available_returns_bool(self) -> None:
        self.assertIsInstance(screenshots.available(), bool)

    def test_capture_blocks_metadata_host(self) -> None:
        with self.assertRaises(ProbeBlocked):
            screenshots.capture(self.project_id, "http://169.254.169.254/latest/meta-data/")

    def test_capture_rejects_non_http_scheme(self) -> None:
        with self.assertRaises(ProbeBlocked):
            screenshots.capture(self.project_id, "file:///etc/passwd")

    def test_screenshots_dir_is_under_home(self) -> None:
        from cyberbox.config import get_settings
        self.assertEqual(get_settings().screenshots_dir, Path(self.temp.name) / "screenshots")

    def test_list_and_get_empty(self) -> None:
        self.assertEqual(screenshots.list_shots(self.project_id), [])
        self.assertIsNone(screenshots.get_shot("nope"))


if __name__ == "__main__":
    unittest.main()
