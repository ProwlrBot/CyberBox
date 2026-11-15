"""cve-intel adapter + its scheduler job kind.

Uses a throwaway fake cve-intel repo (a stub scripts/hunt.sh) in tmpfs so the
subprocess round-trip is real but hermetic — the user's actual ~/cve-intel is
never touched.
"""
from __future__ import annotations

import json
import os
import stat
import tempfile
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import cve_intel, scheduler


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_fake_repo(base: Path, slug: str = "acme-plugin",
                    candidates: int = 2, exit_code: int = 0) -> Path:
    """A minimal cve-intel clone: scripts/hunt.sh that drops a candidate index."""
    root = base / "cve-intel"
    (root / "scripts").mkdir(parents=True)
    findings = root / "labs" / "findings" / slug / "candidates"
    findings.mkdir(parents=True)
    index = findings / "index.json"
    index.write_text(json.dumps({"candidates": [{"id": i} for i in range(candidates)]}))
    hunt = root / "scripts" / "hunt.sh"
    # Stub echoes its args and exits with the requested code — proves argv passing.
    hunt.write_text(
        "#!/usr/bin/env bash\n"
        f'echo "hunt invoked slug=$1 args=$*"\n'
        f"exit {exit_code}\n")
    hunt.chmod(hunt.stat().st_mode | stat.S_IEXEC)
    return root


class CveIntelAdapterTest(unittest.TestCase):
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

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    # --- resolve_repo -----------------------------------------------------
    def test_resolve_repo_missing_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            cve_intel.resolve_repo(str(self.base / "nope"))

    def test_resolve_repo_explicit(self) -> None:
        root = _make_fake_repo(self.base)
        self.assertEqual(cve_intel.resolve_repo(str(root)), root.resolve())

    # --- slug validation (arg-injection guard) ----------------------------
    def test_rejects_bad_slug(self) -> None:
        root = _make_fake_repo(self.base)
        # note: input is lowercased first, so "FOO" normalises to a valid "foo"
        for bad in ["../etc", "a b", "foo;rm -rf", "foo/bar", "-theme", ""]:
            with self.assertRaises(ValueError):
                cve_intel.run_hunt(bad, repo=str(root))

    def test_rejects_bad_mode(self) -> None:
        root = _make_fake_repo(self.base)
        with self.assertRaises(ValueError):
            cve_intel.run_hunt("acme-plugin", mode="exploit", repo=str(root))

    # --- real subprocess round-trip ---------------------------------------
    def test_static_hunt_round_trip(self) -> None:
        root = _make_fake_repo(self.base, slug="acme-plugin", candidates=3)
        res = cve_intel.run_hunt("acme-plugin", repo=str(root))
        self.assertTrue(res["ok"])
        self.assertEqual(res["mode"], "static")
        self.assertEqual(res["returncode"], 0)
        self.assertEqual(res["candidates"], 3)
        self.assertIn("--static", res["stdout_tail"])  # default mode flag passed
        self.assertIn("slug=acme-plugin", res["stdout_tail"])

    def test_full_mode_opt_in_flag(self) -> None:
        root = _make_fake_repo(self.base)
        res = cve_intel.run_hunt("acme-plugin", mode="full", repo=str(root))
        self.assertIn("--full", res["stdout_tail"])

    def test_nonzero_exit_is_result_not_raise(self) -> None:
        root = _make_fake_repo(self.base, exit_code=2)
        res = cve_intel.run_hunt("acme-plugin", repo=str(root))
        self.assertFalse(res["ok"])
        self.assertEqual(res["returncode"], 2)

    def test_env_home_fallback(self) -> None:
        root = _make_fake_repo(self.base)
        old = os.environ.get("CVE_INTEL_HOME")
        os.environ["CVE_INTEL_HOME"] = str(root)
        try:
            res = cve_intel.run_hunt("acme-plugin")
            self.assertTrue(res["ok"])
        finally:
            if old is None:
                os.environ.pop("CVE_INTEL_HOME", None)
            else:
                os.environ["CVE_INTEL_HOME"] = old

    # --- scheduler wiring -------------------------------------------------
    def test_create_job_requires_slug(self) -> None:
        with self.assertRaises(ValueError):
            scheduler.create_job("cve_intel_hunt", 3600, spec={})

    def test_scheduled_cve_intel_hunt_runs(self) -> None:
        root = _make_fake_repo(self.base, slug="acme-plugin", candidates=2)
        project_id = str(uuid.uuid4())
        db.insert("projects", {"id": project_id, "slug": "p1", "name": "P",
                               "created_at": _now()})
        job = scheduler.create_job(
            "cve_intel_hunt", 3600,
            spec={"slug": "acme-plugin", "repo": str(root)},
            project_id=project_id)
        results = scheduler.run_due()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["status"], "ok")
        self.assertEqual(results[0]["output"]["candidates"], 2)
        self.assertEqual(scheduler.get_job(job["id"])["last_status"], "ok")


if __name__ == "__main__":
    unittest.main()
