from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import taxonomy


class TaxonomyTest(unittest.TestCase):
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
        taxonomy.ensure_seeded()
        self.project_id = str(uuid.uuid4())
        db.insert("projects", {"id": self.project_id, "slug": self.project_id,
                               "name": "Tax test", "description": "", "created_at": "now"})

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def test_seed_is_idempotent(self) -> None:
        first = taxonomy.ensure_seeded()
        taxonomy.ensure_seeded()  # again
        self.assertEqual(len(taxonomy.list_families()), first["families"])
        self.assertEqual(len(taxonomy.list_classes()), first["classes"])

    def test_money_families_flagged(self) -> None:
        fams = {f["num"]: f for f in taxonomy.list_families()}
        self.assertEqual(fams[14]["money_rank"], 1)  # broken access control, top money
        self.assertIsNone(fams[16]["money_rank"])     # XSS: volume, not money

    def test_coverage_set_and_summary(self) -> None:
        cls = taxonomy.list_classes(family_num=9)[0]  # an SSRF class
        taxonomy.set_coverage(self.project_id, cls["id"], "covered", note="read IMDS role creds")
        cov = {c["id"]: c for c in taxonomy.coverage(self.project_id)}
        self.assertEqual(cov[cls["id"]]["status"], "covered")
        summ = taxonomy.coverage_summary(self.project_id)
        self.assertEqual(summ["by_status"]["covered"], 1)

    def test_set_coverage_rejects_bad_status_and_class(self) -> None:
        cls = taxonomy.list_classes()[0]
        with self.assertRaises(ValueError):
            taxonomy.set_coverage(self.project_id, cls["id"], "bogus")
        with self.assertRaises(ValueError):
            taxonomy.set_coverage(self.project_id, "no-such-class", "covered")

    def test_chain_matcher_surfaces_lead_then_ready(self) -> None:
        # Find the Blind SSRF + IMDS chain's SSRF component class and cover it.
        ssrf = next(c for c in taxonomy.list_classes(9) if "blind" in c["name"].lower())
        taxonomy.set_coverage(self.project_id, ssrf["id"], "covered")
        chains = taxonomy.reachable_chains(self.project_id)
        blind = next((c for c in chains if "Blind SSRF" in c["name"]), None)
        self.assertIsNotNone(blind, "Blind SSRF chain should surface as a lead once SSRF is covered")
        self.assertFalse(blind["ready"])            # still missing IMDSv1
        self.assertGreaterEqual(blind["have"], 1)
        self.assertTrue(blind["missing"])            # names the component still needed

    def test_no_chains_without_any_coverage(self) -> None:
        self.assertEqual(taxonomy.reachable_chains(self.project_id), [])

    def test_no_false_ready_from_shared_keywords(self) -> None:
        # Regression: covering only "Open redirect" must NOT mark the Open-redirect->OAuth->ATO
        # chain ready, even though "Open redirect" and "OAuth redirect_uri" share the word redirect.
        oredir = next(c for c in taxonomy.list_classes(19) if "open redirect" in c["name"].lower())
        taxonomy.set_coverage(self.project_id, oredir["id"], "covered")
        chains = taxonomy.reachable_chains(self.project_id)
        ato = next(c for c in chains if c["name"].startswith("Open redirect"))
        self.assertFalse(ato["ready"], "must not over-claim the chain is complete")
        self.assertEqual(ato["have"], 1)
        self.assertEqual(ato["total"], 2)
        self.assertTrue(any("OAuth redirect_uri" in m for m in ato["missing"]))

    def test_manual_component_never_auto_satisfied(self) -> None:
        # The Blind SSRF chain's second component ("IMDSv1 reachable") has no class, so the chain
        # can never be auto-ready from coverage alone — the hunter confirms it manually.
        ssrf = next(c for c in taxonomy.list_classes(9) if "blind" in c["name"].lower())
        taxonomy.set_coverage(self.project_id, ssrf["id"], "covered")
        blind = next(c for c in taxonomy.reachable_chains(self.project_id) if "Blind SSRF" in c["name"])
        self.assertFalse(blind["ready"])
        self.assertTrue(any("confirm manually" in m for m in blind["missing"]))

    def test_reportability_gate_blocks_informational_standalone(self) -> None:
        selfxss = next(c for c in taxonomy.list_classes(16) if "self-xss" in c["name"].lower())
        rep = taxonomy.reportability(selfxss["id"])
        self.assertFalse(rep["reportable_standalone"])
        self.assertIn("chain", rep["reason"])
        self.assertTrue(rep["feeds_chains"])  # self-xss feeds at least one chain

    def test_reportability_allows_impactful_class(self) -> None:
        idor = next(c for c in taxonomy.list_classes(14) if "bola" in c["name"].lower())
        rep = taxonomy.reportability(idor["id"])
        self.assertTrue(rep["reportable_standalone"])
        self.assertEqual(len(rep["checklist"]), 7)


if __name__ == "__main__":
    unittest.main()
