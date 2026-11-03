from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "workspace-migrate.sh"


class WorkspaceMigrationTest(unittest.TestCase):
    def run_migration(self, home: Path) -> None:
        subprocess.run(
            ["sh", str(SCRIPT)],
            check=True,
            capture_output=True,
            text=True,
            env={**os.environ, "CYBERBOX_WORKSPACE_HOME": str(home)},
        )

    def test_migrates_legacy_database_without_removing_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            legacy = home / ".neo" / "neo.db"
            legacy.parent.mkdir()
            legacy.write_bytes(b"legacy-database")

            self.run_migration(home)

            destination = home / ".cyberbox" / "cyberbox.db"
            self.assertEqual(destination.read_bytes(), b"legacy-database")
            self.assertEqual(legacy.read_bytes(), b"legacy-database")
            self.assertTrue((home / ".cyberbox/migrations/001-workspace-layout").is_file())
            self.assertTrue((home / "exports/evidence").is_dir())

    def test_is_idempotent_and_never_overwrites_current_database(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            state = home / ".cyberbox"
            state.mkdir()
            current = state / "cyberbox.db"
            current.write_bytes(b"current")
            (home / "neo.db").write_bytes(b"legacy")

            self.run_migration(home)
            self.run_migration(home)

            self.assertEqual(current.read_bytes(), b"current")


if __name__ == "__main__":
    unittest.main()
