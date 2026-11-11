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


if __name__ == "__main__":
    unittest.main()
