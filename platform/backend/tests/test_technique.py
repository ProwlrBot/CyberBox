"""Technique extraction — deterministic report→invariant classification, the library, and the
target overlay. The point of these tests: the classifier reads the report TEXT, so it resolves to
the specific boundary technique, not the coarse CWE bucket."""
from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import taxonomy, technique


def _disc(title: str, cwe: str | None = None, sev: str = "medium", amount=None, summary: str = "") -> str:
    did = str(uuid.uuid4())
    db.insert("disclosures", {
        "id": did, "report_id": str(uuid.uuid4()), "source": "test", "title": title,
        "url": "https://hackerone.com/reports/x", "cwe": cwe, "severity": sev,
        "bounty_amount": amount, "summary": summary, "cve_ids": "[]", "ingested_at": "now"})
    return did


class TechniqueTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(dir="/dev/shm" if os.path.isdir("/dev/shm") else None)
        settings = Settings(home=Path(self.temp.name))
        settings.ensure_dirs()
        import cyberbox.config as config
        config._settings = settings
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close(); del db._local.conn
        db.init_db()
        taxonomy.ensure_seeded()

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close(); del db._local.conn
        self.temp.cleanup()

    # ── The research's hard cases: text beats the coarse CWE bucket ──────────────
    def test_stored_xss_admin_takeover_resolves_to_privilege_elevation(self) -> None:
        did = _disc("Cross-account stored XSS leading to administrator takeover", "CWE-79", "high", 8000,
                    "admin editor normalized attacker content inserted via innerHTML; CSP nonce allowed "
                    "script in the administrator session; authenticated actions granted admin privileges")
        card = technique.extract_and_store(did)
        self.assertEqual(card["primary"]["class_id"], "f16-stored-xss-privileged-user-with-privilege-elevation")
        self.assertTrue(card["primary"]["is_boundary"])
        self.assertEqual(card["primary"]["confidence"], "high")
        self.assertEqual(card["status"], "observed")  # never 'verified'
        self.assertTrue(card["primary"]["invariant"])  # the authored boundary line is attached

    def test_openapi_resolves_to_parser_differential(self) -> None:
        did = _disc("OpenAPI parser differential leads to local file read", "CWE-22", "medium", 1000,
                    "different parsers for availability vs handling the selected schema; nested OpenAPI "
                    "3.0 and top-level 3.1 parsing disagreement; local-file URL in $id changed the base")
        card = technique.extract_and_store(did)
        self.assertEqual(card["primary"]["class_id"], "f11-parser-differentials")
        self.assertTrue(card["primary"]["is_boundary"])

    def test_precedence_mismatch_resolves_to_hpp(self) -> None:
        did = _disc("Request precedence mismatch leads to blind SQL injection", "CWE-89", "high", None,
                    "permission checks and queries selected different values for the same parameter due "
                    "to inconsistent request-source precedence")
        card = technique.extract_and_store(did)
        self.assertEqual(card["primary"]["class_id"], "f10-http-parameter-pollution-hpp")

    def test_cache_isolation_resolves_to_web_cache_deception(self) -> None:
        did = _disc("Cache isolation failure leaks session data", "CWE-525", "low", None,
                    "public board response used Cache-Control: public without Vary: Cookie; a signed-in "
                    "response was cached at the edge and served to anonymous visitors")
        card = technique.extract_and_store(did)
        self.assertEqual(card["primary"]["class_id"], "f2-web-cache-deception")

    def test_validation_to_persistence_resolves_to_inconsistent_state(self) -> None:
        did = _disc("Appointment validation allows arbitrary booking", "CWE-840", "low", None,
                    "the endpoint checked whether a valid appointment slot existed but persisted the "
                    "attacker-supplied time instead of the validated slot")
        card = technique.extract_and_store(did)
        self.assertEqual(card["primary"]["class_id"], "f12-inconsistent-state-across-services")

    # ── Disambiguation: bare CWE must not over-trigger a boundary signal ─────────
    def test_plain_reflected_xss_does_not_become_mxss(self) -> None:
        did = _disc("Reflected XSS in search parameter", "CWE-79", "low", 150,
                    "the q parameter is reflected without encoding, reflected xss")
        card = technique.extract_and_store(did)
        self.assertEqual(card["primary"]["class_id"], "f16-reflected-xss-non-self")

    def test_unmapped_report_with_no_signal_yields_no_primary(self) -> None:
        did = _disc("Some unusual issue", "CWE-99999", "low", None, "nothing recognisable here")
        card = technique.extract_and_store(did)
        self.assertIsNone(card["primary"])
        self.assertEqual(card["techniques"], [])

    def test_zero_technique_disclosure_is_marked_and_not_reprocessed(self) -> None:
        did = _disc("Some unusual issue", "CWE-99999", "low", None, "nothing recognisable here")
        technique.extract_and_store(did)
        # a sentinel row (class_id NULL) marks it processed so the LEFT JOIN skip-path ignores it
        sentinel = db.query_one(
            "SELECT id FROM disclosure_techniques WHERE disclosure_id=? AND class_id IS NULL", [did])
        self.assertIsNotNone(sentinel)
        # a subsequent extract_all (skip-path) must NOT reprocess it
        self.assertEqual(technique.extract_all()["processed"], 0)

    def test_card_is_read_only_after_first_classification(self) -> None:
        did = _disc("web cache deception", "CWE-525", "high", 500, "cache deception vary cookie")
        first = technique.card(did)                         # classifies + persists
        self.assertIsNotNone(first["primary"])
        ids_before = {r["id"] for r in db.query(
            "SELECT id FROM disclosure_techniques WHERE disclosure_id=?", [did])}
        second = technique.card(did)                        # must read, not rewrite
        ids_after = {r["id"] for r in db.query(
            "SELECT id FROM disclosure_techniques WHERE disclosure_id=?", [did])}
        self.assertEqual(ids_before, ids_after)             # same rows — no DELETE+re-INSERT
        self.assertEqual(second["primary"]["class_id"], "f2-web-cache-deception")
        self.assertEqual(second["status"], "observed")

    def test_library_rejects_invalid_min_confidence(self) -> None:
        with self.assertRaises(ValueError):
            technique.library(min_confidence="critical")

    # ── Novelty rewards the non-generic ─────────────────────────────────────────
    def test_boundary_scores_higher_novelty_than_commodity_at_equal_pay(self) -> None:
        bnd = technique.extract_and_store(
            _disc("Web cache deception leaks private data", "CWE-525", "high", 1000,
                  "cache deception: cache-control public without vary cookie, personal data cached"))
        gen = technique.extract_and_store(
            _disc("Reflected XSS", "CWE-79", "high", 1000, "reflected xss in a parameter"))
        self.assertGreater(bnd["novelty"], gen["novelty"])

    # ── Library + overlay ───────────────────────────────────────────────────────
    def test_library_dedupes_by_class_and_ranks(self) -> None:
        for i in range(3):
            technique.extract_and_store(
                _disc(f"cache deception #{i}", "CWE-525", "high", 500 + i * 100,
                      "web cache deception, cache-control public, vary cookie missing"))
        lib = technique.library()
        wcd = [L for L in lib if L["class_id"] == "f2-web-cache-deception"]
        self.assertEqual(len(wcd), 1)                 # deduped to one row
        self.assertEqual(wcd[0]["report_count"], 3)   # across three reports
        self.assertTrue(wcd[0]["is_boundary"])
        self.assertEqual(wcd[0]["confidence"], "high")  # strong text match surfaced as trust signal
        self.assertTrue(wcd[0]["invariant"])          # authored invariant attached
        self.assertTrue(wcd[0]["hunt_steps"])         # authored steps attached

    def test_boundary_only_filter(self) -> None:
        technique.extract_and_store(_disc("Reflected XSS", "CWE-79", "low", 100, "reflected xss"))
        technique.extract_and_store(
            _disc("parser differential", "CWE-436", "high", 2000, "two parsers interpret $id differently"))
        lib = technique.library(boundary_only=True)
        self.assertTrue(all(L["is_boundary"] for L in lib))
        self.assertTrue(any(L["class_id"] == "f11-parser-differentials" for L in lib))

    def test_test_plan_carries_invariant_steps_and_observed_disclaimer(self) -> None:
        technique.extract_and_store(
            _disc("web cache deception", "CWE-525", "high", 1000, "cache deception vary cookie"))
        plan = technique.test_plan("f2-web-cache-deception")
        self.assertTrue(plan["invariant"])
        self.assertEqual(len(plan["steps"]), 5)
        self.assertEqual(plan["status"], "observed")
        self.assertIn("NOT a confirmed", plan["disclaimer"])
        self.assertGreaterEqual(len(plan["example_reports"]), 1)

    def test_project_match_drops_covered_and_explains_uncovered(self) -> None:
        pid = str(uuid.uuid4())
        db.insert("projects", {"id": pid, "slug": pid, "name": "t", "description": "", "created_at": "now"})
        technique.extract_and_store(
            _disc("web cache deception", "CWE-525", "high", 1000, "cache deception vary cookie"))
        technique.extract_and_store(
            _disc("parser differential", "CWE-436", "high", 2000, "two parsers $id differently"))
        # mark one class covered on this target → it must drop out of the 'hunt next' overlay
        db.insert("target_coverage", {"id": str(uuid.uuid4()), "project_id": pid,
                                      "class_id": "f2-web-cache-deception",
                                      "status": "covered", "updated_at": "now"})
        leads = technique.match_project(pid)
        ids = {L["class_id"] for L in leads}
        self.assertNotIn("f2-web-cache-deception", ids)
        self.assertIn("f11-parser-differentials", ids)
        self.assertTrue(all("coverage" in L and L["reason"] for L in leads))


if __name__ == "__main__":
    unittest.main()
