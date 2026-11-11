"""Source-revision model (audit #9): revisions, diffs, and regression detection."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import source_revision as sr


class SourceRevisionTest(unittest.TestCase):
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

    def test_register_source_dedups_by_kind_and_identifier(self) -> None:
        a = sr.register_source("gitlab", "group/app")
        b = sr.register_source("gitlab", "group/app", label="updated")
        self.assertEqual(a, b)
        self.assertEqual(len(db.query("SELECT id FROM sources")), 1)
        self.assertEqual(sr.get_source(a)["label"], "updated")

    def test_add_revision_is_idempotent(self) -> None:
        s = sr.register_source("github", "o/r")
        r1 = sr.add_revision(s, "abc123", ref="main")
        r2 = sr.add_revision(s, "abc123", ref="main")
        self.assertEqual(r1, r2)
        self.assertEqual(len(sr.get_source(s)["revisions"]), 1)

    def test_record_diff_round_trips_files_changed(self) -> None:
        s = sr.register_source("github", "o/r")
        sr.record_diff(s, "v1", "v2", files_changed=["auth.py", "db.py"],
                       summary="fix authz", security_relevant=True)
        source = sr.get_source(s)
        self.assertEqual(len(source["diffs"]), 1)
        self.assertEqual(source["diffs"][0]["files_changed"], ["auth.py", "db.py"])
        self.assertEqual(source["diffs"][0]["security_relevant"], 1)

    def test_record_diff_is_idempotent_on_revision_pair(self) -> None:
        s = sr.register_source("github", "o/r")
        sr.record_diff(s, "v1", "v2", summary="first")
        sr.record_diff(s, "v1", "v2", summary="second", security_relevant=True)
        diffs = sr.get_source(s)["diffs"]
        self.assertEqual(len(diffs), 1)
        self.assertEqual(diffs[0]["summary"], "second")
        self.assertEqual(diffs[0]["security_relevant"], 1)

    def test_regression_candidate_when_deployed_is_pre_fix(self) -> None:
        s = sr.register_source("wordpress-plugin", "woocommerce", observed_revision="1.2.0")
        sr.record_diff(s, "1.2.0", "1.2.1", summary="patch SQLi", security_relevant=True)
        hits = sr.regression_candidates(source_id=s)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["from_revision"], "1.2.0")

    def test_no_regression_when_deployed_is_post_fix(self) -> None:
        s = sr.register_source("wordpress-plugin", "woocommerce", observed_revision="1.2.1")
        sr.record_diff(s, "1.2.0", "1.2.1", summary="patch SQLi", security_relevant=True)
        self.assertEqual(sr.regression_candidates(source_id=s), [])

    def test_no_regression_when_diff_not_security_relevant(self) -> None:
        s = sr.register_source("wordpress-plugin", "woocommerce", observed_revision="1.2.0")
        sr.record_diff(s, "1.2.0", "1.2.1", summary="typo fix", security_relevant=False)
        self.assertEqual(sr.regression_candidates(source_id=s), [])

    def test_no_regression_when_observed_revision_unknown(self) -> None:
        s = sr.register_source("wordpress-plugin", "woocommerce")  # no observed_revision
        sr.record_diff(s, "1.2.0", "1.2.1", summary="patch SQLi", security_relevant=True)
        self.assertEqual(sr.regression_candidates(source_id=s), [])

    def test_set_observed_revision_updates_anchor(self) -> None:
        s = sr.register_source("vercel", "proj")
        sr.record_diff(s, "dep-1", "dep-2", summary="fix SSRF", security_relevant=True)
        self.assertEqual(sr.regression_candidates(source_id=s), [])
        sr.set_observed_revision(s, "dep-1")
        self.assertEqual(len(sr.regression_candidates(source_id=s)), 1)


if __name__ == "__main__":
    unittest.main()
