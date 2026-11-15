from __future__ import annotations

import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import engines, taxonomy


class EnginesTest(unittest.TestCase):
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
                               "name": "Eng test", "description": "", "created_at": "now"})

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def test_tags_resolve_to_real_class_ids(self) -> None:
        finding = {"template_id": "CVE-2021-1234", "tags": ["sqli", "injection"], "cve": None}
        ids = engines.classes_for_nuclei(finding)
        self.assertIn(taxonomy.class_id(10, "SQL injection"), ids)
        # "injection" is not a mapped tag — it must not invent coverage.
        self.assertEqual(len(ids), 1)

    def test_cve_finding_marks_known_vuln_class(self) -> None:
        finding = {"template_id": "CVE-2023-9999", "tags": ["tech"], "cve": "CVE-2023-9999"}
        ids = engines.classes_for_nuclei(finding)
        self.assertEqual(ids, [taxonomy.class_id(4, "Known vulnerabilities in edge software")])

    def test_unmapped_finding_marks_nothing(self) -> None:
        self.assertEqual(engines.classes_for_nuclei({"tags": ["misc", "tech"], "cve": None}), [])

    def test_apply_flips_class_to_covered_with_evidence(self) -> None:
        finding = {"template_id": "ssrf-detect", "tags": ["ssrf"], "cve": None}
        marked = engines.apply_nuclei_finding(self.project_id, finding, "vuln-abc")
        cid = taxonomy.class_id(9, "Full-read SSRF")
        self.assertEqual(marked, [cid])
        cov = {c["id"]: c for c in taxonomy.coverage(self.project_id)}
        self.assertEqual(cov[cid]["status"], "covered")
        self.assertIn("vuln-abc", cov[cid]["evidence_ids"])

    def test_evidence_merges_across_findings(self) -> None:
        cid = taxonomy.class_id(16, "Reflected XSS, non-self")
        engines.apply_nuclei_finding(self.project_id, {"template_id": "xss-1", "tags": ["xss"]}, "v1")
        engines.apply_nuclei_finding(self.project_id, {"template_id": "xss-2", "tags": ["xss"]}, "v2")
        cov = {c["id"]: c for c in taxonomy.coverage(self.project_id)}
        self.assertEqual(sorted(cov[cid]["evidence_ids"]), ["v1", "v2"])

    def test_mark_covered_rejects_unknown_class(self) -> None:
        self.assertFalse(engines.mark_covered(self.project_id, "f99-nope", "v1", "note"))

    def test_list_engines_exposes_resolved_coverage(self) -> None:
        engs = engines.list_engines()
        nuclei = next(e for e in engs if e["key"] == "nuclei")
        self.assertGreater(nuclei["covers_count"], 0)
        # Every declared class id actually exists in the seeded spine.
        for c in nuclei["covers"]:
            self.assertTrue(db.query_one("SELECT id FROM taxonomy_classes WHERE id=?", [c["class_id"]]))
        # The fingerprint engine is registered and its static classes resolve to real ids too.
        fp = next(e for e in engs if e["key"] == "fingerprint")
        self.assertEqual(fp["covers_count"], 3)
        for c in fp["covers"]:
            self.assertTrue(db.query_one("SELECT id FROM taxonomy_classes WHERE id=?", [c["class_id"]]))

    # ── Fingerprint engine ──────────────────────────────────────────────────────

    def test_fingerprint_wp_user_enum_marks_class_with_stored_evidence(self) -> None:
        result = {"target": "https://wp.example", "users": [{"id": 1, "slug": "admin"}],
                  "exposed": {"rest_users": True}, "plugins": []}
        marked = engines.apply_fingerprint_finding(self.project_id, "wordpress", result, "https://wp.example")
        cid = taxonomy.class_id(13, "Username / email enumeration")
        self.assertEqual(marked, [cid])
        cov = {c["id"]: c for c in taxonomy.coverage(self.project_id)}
        self.assertEqual(cov[cid]["status"], "covered")
        # Coverage points at a real stored vulnerabilities row, not a phantom id.
        ev_id = cov[cid]["evidence_ids"][0]
        row = db.query_one("SELECT template_id, host FROM vulnerabilities WHERE id=?", [ev_id])
        self.assertEqual(row["template_id"], "fingerprint-wp-user-enum")

    def test_fingerprint_without_observation_marks_nothing(self) -> None:
        # REST users disabled and no vulnerable plugin → no confirmed finding, no coverage.
        result = {"target": "https://wp.example", "users": [], "exposed": {"rest_users": False},
                  "plugins": [{"slug": "akismet", "version": "5.0", "known_advisories": 0}]}
        self.assertEqual(engines.apply_fingerprint_finding(self.project_id, "wordpress", result, "x"), [])
        self.assertFalse([c for c in taxonomy.coverage(self.project_id) if c["status"] != "none"])
        self.assertIsNone(db.query_one("SELECT id FROM vulnerabilities WHERE project_id=?", [self.project_id]))

    def test_fingerprint_reprobe_reuses_one_evidence_row(self) -> None:
        result = {"target": "https://wp.example", "users": [{"id": 1, "slug": "admin"}],
                  "exposed": {"rest_users": True}, "plugins": []}
        engines.apply_fingerprint_finding(self.project_id, "wordpress", result, "https://wp.example")
        engines.apply_fingerprint_finding(self.project_id, "wordpress", result, "https://wp.example")
        rows = db.query("SELECT id FROM vulnerabilities WHERE project_id=?", [self.project_id])
        self.assertEqual(len(rows), 1)  # dedup_key kept the re-probe from duplicating evidence

    # ── CVE-intel engine ────────────────────────────────────────────────────────

    def test_cve_hit_marks_known_vuln_class_with_stored_evidence(self) -> None:
        marked = engines.apply_cve_hit(self.project_id, {"cve_id": "CVE-2024-1234", "tech": "nginx",
                                                         "severity": "high", "cvss_score": 8.1})
        cid = taxonomy.class_id(4, "Known vulnerabilities in edge software")
        self.assertEqual(marked, [cid])
        cov = {c["id"]: c for c in taxonomy.coverage(self.project_id)}
        self.assertEqual(cov[cid]["status"], "covered")
        # Coverage points at a real stored vulnerabilities row carrying the CVE id.
        ev_id = cov[cid]["evidence_ids"][0]
        row = db.query_one("SELECT cve, template_id FROM vulnerabilities WHERE id=?", [ev_id])
        self.assertEqual(row["cve"], "CVE-2024-1234")

    def test_cve_hit_without_id_marks_nothing(self) -> None:
        self.assertEqual(engines.apply_cve_hit(self.project_id, {"cve_id": ""}), [])
        self.assertFalse([c for c in taxonomy.coverage(self.project_id) if c["status"] != "none"])
        self.assertIsNone(db.query_one("SELECT id FROM vulnerabilities WHERE project_id=?", [self.project_id]))

    def test_cve_resweep_reuses_one_evidence_row(self) -> None:
        engines.apply_cve_hit(self.project_id, {"cve_id": "CVE-2024-1234", "tech": "nginx"})
        engines.apply_cve_hit(self.project_id, {"cve_id": "CVE-2024-1234", "tech": "nginx"})
        rows = db.query("SELECT id FROM vulnerabilities WHERE project_id=?", [self.project_id])
        self.assertEqual(len(rows), 1)

    def test_cve_intel_engine_registered(self) -> None:
        eng = next(e for e in engines.list_engines() if e["key"] == "cve-intel")
        self.assertEqual(eng["covers_count"], 1)
        self.assertTrue(db.query_one("SELECT id FROM taxonomy_classes WHERE id=?", [eng["covers"][0]["class_id"]]))

    # ── vulnx engine ──────────────────────────────────────────────────────────────

    def test_vulnx_hit_maps_tags_and_cwe_to_specific_classes(self) -> None:
        hit = {"cve_id": "CVE-2026-69137", "tech": "suitecrm", "severity": "high",
               "cwe": ["CWE-918"], "tags": ["cve", "suitecrm", "ssrf"], "is_kev": False}
        ids = engines.classes_for_vulnx(hit)
        self.assertIn(taxonomy.class_id(9, "Full-read SSRF"), ids)                       # from tag + CWE-918
        self.assertIn(taxonomy.class_id(4, "Known vulnerabilities in edge software"), ids)  # always
        # Noise tags ("cve", "suitecrm") invent nothing.
        self.assertEqual(len(ids), 2)

    def test_vulnx_untagged_hit_marks_only_known_vuln(self) -> None:
        ids = engines.classes_for_vulnx({"cve_id": "CVE-2026-1", "tags": ["cve", "nginx"], "cwe": []})
        self.assertEqual(ids, [taxonomy.class_id(4, "Known vulnerabilities in edge software")])

    def test_vulnx_apply_stores_evidence_and_kev_is_verified(self) -> None:
        hit = {"cve_id": "CVE-2026-115886", "tech": "mlflow", "severity": "medium",
               "cwe": ["CWE-918"], "tags": ["ssrf"], "is_kev": True, "epss_score": 0.007, "is_template": True}
        marked = engines.apply_vulnx_hit(self.project_id, hit)
        self.assertIn(taxonomy.class_id(9, "Full-read SSRF"), marked)
        cov = {c["id"]: c for c in taxonomy.coverage(self.project_id)}
        ev_id = cov[taxonomy.class_id(9, "Full-read SSRF")]["evidence_ids"][0]
        row = db.query_one("SELECT cve, verified FROM vulnerabilities WHERE id=?", [ev_id])
        self.assertEqual(row["cve"], "CVE-2026-115886")
        self.assertEqual(row["verified"], 1)  # KEV = actively exploited → verified

    def test_vulnx_resweep_reuses_one_evidence_row(self) -> None:
        hit = {"cve_id": "CVE-2026-115886", "tech": "mlflow", "tags": ["ssrf"]}
        engines.apply_vulnx_hit(self.project_id, hit)
        engines.apply_vulnx_hit(self.project_id, hit)
        rows = db.query("SELECT id FROM vulnerabilities WHERE project_id=? AND dedup_key=?",
                        [self.project_id, "vulnx:CVE-2026-115886"])
        self.assertEqual(len(rows), 1)

    def test_vulnx_engine_registered_with_resolved_classes(self) -> None:
        eng = next(e for e in engines.list_engines() if e["key"] == "vulnx")
        self.assertGreater(eng["covers_count"], 5)
        for c in eng["covers"]:
            self.assertTrue(db.query_one("SELECT id FROM taxonomy_classes WHERE id=?", [c["class_id"]]))

    def test_fingerprint_gitlab_version_disclosure_marks_class(self) -> None:
        result = {"target": "https://gl.example", "version": "16.3.0", "revision": "abc123",
                  "exposed": {"public_api": True}}
        marked = engines.apply_fingerprint_finding(self.project_id, "gitlab", result, "https://gl.example")
        self.assertEqual(
            marked, [taxonomy.class_id(1, "Fingerprinting / banner disclosure, software versions in headers")])


if __name__ == "__main__":
    unittest.main()
