from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from cyberbox.services import fingerprint


class MetadataGuardTest(unittest.TestCase):
    def test_metadata_ip_is_blocked(self) -> None:
        # 169.254.169.254 (cloud IMDS) must be refused before any socket opens.
        with mock.patch.object(fingerprint.socket, "getaddrinfo",
                               return_value=[(2, 1, 6, "", ("169.254.169.254", 80))]):
            with self.assertRaises(fingerprint.ProbeBlocked):
                fingerprint._assert_not_metadata("metadata.internal")

    def test_public_ip_passes_guard(self) -> None:
        with mock.patch.object(fingerprint.socket, "getaddrinfo",
                               return_value=[(2, 1, 6, "", ("93.184.216.34", 443))]):
            fingerprint._assert_not_metadata("example.test")  # no raise

    def test_get_refuses_metadata_host(self) -> None:
        with mock.patch.object(fingerprint.socket, "getaddrinfo",
                               return_value=[(2, 1, 6, "", ("169.254.169.254", 80))]):
            with self.assertRaises(fingerprint.ProbeBlocked):
                fingerprint._get("http://169.254.169.254/latest/meta-data/")


class WordpressParseTest(unittest.TestCase):
    def test_parses_version_plugins_users(self) -> None:
        landing = ('<html><head>'
                   '<meta name="generator" content="WordPress 6.4.2"/>'
                   '<link href="/wp-content/plugins/woocommerce/assets/x.css?ver=8.5.1"/>'
                   '<link href="/wp-content/plugins/contact-form-7/style.css?ver=5.9"/>'
                   '<link href="/wp-content/themes/astra/style.css?ver=4.6"/>'
                   '</head></html>')
        rest = '{"namespaces":["wp/v2","woocommerce/v3"],"routes":{"/":1,"/wp/v2":1,"/wp/v2/posts":1}}'
        users = '[{"id":1,"name":"admin","slug":"admin"},{"id":2,"name":"editor","slug":"editor"}]'

        def fake_get(url: str):
            if url.endswith("/wp-json/"):
                return 200, {}, rest
            if url.endswith("/wp-json/wp/v2/users"):
                return 200, {}, users
            if url.endswith("/"):
                return 200, {"server": "nginx"}, landing
            if url.endswith("/xmlrpc.php"):
                return 405, {}, ""
            if url.endswith("/readme.html"):
                return 200, {}, ""
            if url.endswith("/wp-login.php"):
                return 200, {}, ""
            return 0, {}, ""

        with mock.patch.object(fingerprint, "_get", side_effect=fake_get):
            r = fingerprint.fingerprint_wordpress("https://shop.example.test")

        self.assertTrue(r["is_wordpress"])
        self.assertEqual(r["version"], "6.4.2")
        self.assertTrue(r["rest_enabled"])
        self.assertEqual(r["route_count"], 3)
        self.assertIn("woocommerce/v3", r["namespaces"])
        slugs = {p["slug"]: p["version"] for p in r["plugins"]}
        self.assertEqual(slugs["woocommerce"], "8.5.1")
        self.assertEqual(slugs["contact-form-7"], "5.9")
        self.assertEqual(len(r["users"]), 2)
        self.assertEqual(r["exposed"]["user_enum_count"], 2)
        self.assertTrue(r["exposed"]["xmlrpc"])

    def test_non_wordpress_site_is_flagged_false(self) -> None:
        with mock.patch.object(fingerprint, "_get", return_value=(200, {}, "<html>nothing</html>")):
            r = fingerprint.fingerprint_wordpress("https://plain.example.test")
        self.assertFalse(r["is_wordpress"])
        self.assertEqual(r["plugins"], [])


class GitlabParseTest(unittest.TestCase):
    def test_parses_version_and_public_projects(self) -> None:
        ver = '{"version":"16.7.0","revision":"abc123def","enterprise":false}'
        projects = ('[{"path_with_namespace":"group/app","name":"app","star_count":12,'
                    '"last_activity_at":"2026-01-01T00:00:00Z"}]')

        def fake_get(url: str):
            if url.endswith("/api/v4/version"):
                return 200, {"x-gitlab-feature-category": "api"}, ver
            if url.endswith("/"):
                return 200, {"server": "nginx"}, "<html>GitLab</html>"
            if url.endswith("/users/sign_up"):
                return 200, {}, ""
            if "visibility=public" in url:
                return 200, {}, projects
            if url.endswith("/explore"):
                return 200, {}, ""
            if url.endswith("/api/graphql"):
                return 401, {}, ""
            return 0, {}, ""

        with mock.patch.object(fingerprint, "_get", side_effect=fake_get):
            r = fingerprint.fingerprint_gitlab("https://git.example.test")

        self.assertTrue(r["is_gitlab"])
        self.assertEqual(r["version"], "16.7.0")
        self.assertEqual(r["revision"], "abc123def")
        self.assertTrue(r["signup_enabled"])
        self.assertEqual(r["public_project_count"], 1)
        self.assertEqual(r["public_projects"][0]["path"], "group/app")
        self.assertTrue(r["exposed"]["open_signup"])
        self.assertTrue(r["exposed"]["graphql"])

    def test_auth_required_api_still_detects_gitlab(self) -> None:
        def fake_get(url: str):
            if url.endswith("/api/v4/version"):
                return 401, {}, ""
            return 0, {}, ""
        with mock.patch.object(fingerprint, "_get", side_effect=fake_get):
            r = fingerprint.fingerprint_gitlab("https://git.example.test")
        self.assertTrue(r["is_gitlab"])
        self.assertIsNone(r["version"])


class AdvisoryEnrichmentTest(unittest.TestCase):
    """Regression: fingerprinted plugins must be flagged against known advisories.
    Guards the advisory_id key the enrichment reads from match_product()."""

    def setUp(self) -> None:
        from cyberbox import db
        from cyberbox.config import Settings
        import cyberbox.config as config

        temp_root = "/dev/shm" if os.path.isdir("/dev/shm") else None
        self.temp = tempfile.TemporaryDirectory(dir=temp_root)
        settings = Settings(home=Path(self.temp.name))
        settings.ensure_dirs()
        config._settings = settings
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        db.init_db()
        self.db = db

    def tearDown(self) -> None:
        existing = getattr(self.db._local, "conn", None)
        if existing is not None:
            existing.close()
            del self.db._local.conn
        self.temp.cleanup()

    def test_known_vulnerable_plugin_is_flagged(self) -> None:
        from cyberbox.services import advisories
        from cyberbox.routers.api import _enrich_plugins_with_advisories

        adv_id = advisories.upsert_advisory(
            {"source": "test", "external_id": "T-1", "title": "WooCommerce RCE",
             "product_slug": "woocommerce", "product_type": "plugin"})
        advisories.add_affected_version(adv_id, "woocommerce", "8.0.0", "8.6.0", None)

        plugins = [{"slug": "woocommerce", "version": "8.5.1"},
                   {"slug": "contact-form-7", "version": "5.9"},
                   {"slug": "unknown-ver", "version": None}]
        enriched = _enrich_plugins_with_advisories(plugins)

        by_slug = {p["slug"]: p for p in enriched}
        self.assertEqual(by_slug["woocommerce"]["known_advisories"], 1)
        self.assertEqual(by_slug["woocommerce"]["advisory_ids"], [adv_id])
        self.assertEqual(by_slug["contact-form-7"]["known_advisories"], 0)
        self.assertEqual(by_slug["unknown-ver"]["known_advisories"], 0)

    def test_version_outside_range_not_flagged(self) -> None:
        from cyberbox.services import advisories
        from cyberbox.routers.api import _enrich_plugins_with_advisories

        adv_id = advisories.upsert_advisory(
            {"source": "test", "external_id": "T-2", "title": "old bug",
             "product_slug": "woocommerce", "product_type": "plugin"})
        advisories.add_affected_version(adv_id, "woocommerce", "7.0.0", "7.5.0", None)

        enriched = _enrich_plugins_with_advisories([{"slug": "woocommerce", "version": "8.5.1"}])
        self.assertEqual(enriched[0]["known_advisories"], 0)


if __name__ == "__main__":
    unittest.main()
