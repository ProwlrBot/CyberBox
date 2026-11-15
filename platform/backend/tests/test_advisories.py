"""Advisory store: dedup, version-range matching, and affected-version linkage (gap #7)."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import advisories


class AdvisoriesTest(unittest.TestCase):
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

    def _advisory(self, external_id: str = "CVE-2024-0001", slug: str = "woocommerce") -> str:
        return advisories.upsert_advisory({
            "source": "patchstack", "external_id": external_id,
            "title": "SQLi in WooCommerce", "severity": "high", "cvss": 8.2,
            "cwe": "CWE-89", "product_type": "wordpress-plugin", "product_slug": slug,
            "references": ["https://patchstack.com/x"], "raw": {"id": external_id},
        })

    def test_upsert_dedups_by_source_and_external_id(self) -> None:
        self._advisory()
        self._advisory()  # same (source, external_id) again
        rows = db.query("SELECT id FROM advisories")
        self.assertEqual(len(rows), 1)

    def test_references_round_trips_as_list(self) -> None:
        aid = self._advisory()
        advisory = advisories.get_advisory(aid)
        self.assertEqual(advisory["reference_urls"], ["https://patchstack.com/x"])

    def test_version_affected_bounds(self) -> None:
        # [1.2.0, 1.5.3): introduced inclusive, fixed exclusive
        self.assertTrue(advisories.version_affected("1.2.0", "1.2.0", "1.5.3"))
        self.assertTrue(advisories.version_affected("1.5.2", "1.2.0", "1.5.3"))
        self.assertFalse(advisories.version_affected("1.5.3", "1.2.0", "1.5.3"))
        self.assertFalse(advisories.version_affected("1.1.9", "1.2.0", "1.5.3"))
        self.assertTrue(advisories.version_affected("9.9.9", "1.2.0", None))  # unpatched

    def test_match_product_returns_covering_advisories(self) -> None:
        aid = self._advisory()
        advisories.add_affected_version(aid, "woocommerce", "1.2.0", "1.5.3")
        self.assertEqual(len(advisories.match_product("woocommerce", "1.4.0")), 1)
        self.assertEqual(advisories.match_product("woocommerce", "1.5.3"), [])
        self.assertEqual(advisories.match_product("woocommerce", "0.9.0"), [])
        self.assertEqual(advisories.match_product("elementor", "1.4.0"), [])

    def test_get_advisory_includes_affected_versions(self) -> None:
        aid = self._advisory()
        advisories.add_affected_version(aid, "woocommerce", "1.2.0", "1.5.3")
        advisory = advisories.get_advisory(aid)
        self.assertEqual(len(advisory["affected_versions"]), 1)
        self.assertEqual(advisory["affected_versions"][0]["version_fixed"], "1.5.3")


if __name__ == "__main__":
    unittest.main()
