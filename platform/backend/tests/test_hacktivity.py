"""Disclosed-report intel — ingest, dedup, CWE→taxonomy mapping, market overlay, enrich guards."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import hacktivity, taxonomy


def _node(rid: str, cwe: str, sev: str, amount, when: str, summary: str = "s") -> dict:
    return {
        "cwe": cwe, "cve_ids": [], "severity_rating": sev, "total_awarded_amount": amount,
        "reporter": {"username": "r-" + rid}, "team": {"handle": "acme", "name": "Acme", "currency": "USD"},
        "report": {"_id": rid, "title": f"report {rid}", "url": f"https://hackerone.com/reports/{rid}",
                   "substate": "resolved", "disclosed_at": when,
                   "report_generated_content": {"hacktivity_summary": summary}},
    }


class HacktivityTest(unittest.TestCase):
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
        taxonomy.ensure_seeded()  # need taxonomy_classes for CWE→class resolution

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close(); del db._local.conn
        self.temp.cleanup()

    def test_ingest_maps_cwe_to_taxonomy_class(self) -> None:
        r = hacktivity.ingest_jsonl(json.dumps(_node("1", "CWE-79", "high", 500, "2026-11-10T00:00:00Z")))
        self.assertEqual(r["inserted"], 1)
        d = hacktivity.list_disclosures()[0]
        self.assertEqual(d["class_id"], "f16-reflected-xss-non-self")
        self.assertEqual(d["family_num"], 16)

    def test_unmapped_cwe_is_counted_but_classless(self) -> None:
        r = hacktivity.ingest_jsonl(json.dumps(_node("2", "CWE-99999", "low", 0, "2026-11-09T00:00:00Z")))
        self.assertEqual(r["unmapped"], 1)
        self.assertIsNone(hacktivity.list_disclosures()[0]["class_id"])

    def test_dedup_on_report_id(self) -> None:
        line = json.dumps(_node("3", "CWE-918", "critical", 9000, "2026-11-11T00:00:00Z"))
        hacktivity.ingest_jsonl(line)
        again = hacktivity.ingest_jsonl(line)
        self.assertEqual(again["inserted"], 0)
        self.assertEqual(again["skipped"], 1)

    def test_malformed_lines_are_skipped_not_fatal(self) -> None:
        feed = "not json\n" + json.dumps(_node("4", "CWE-79", "medium", 100, "2026-11-08T00:00:00Z")) + "\n{bad"
        r = hacktivity.ingest_jsonl(feed)
        self.assertEqual(r["parsed"], 1)
        self.assertEqual(r["inserted"], 1)

    def test_market_by_class_ranks_by_bounty(self) -> None:
        hacktivity.ingest_jsonl("\n".join([
            json.dumps(_node("5", "CWE-918", "critical", 9000, "2026-11-11T00:00:00Z")),
            json.dumps(_node("6", "CWE-79", "high", 1500, "2026-11-10T00:00:00Z")),
            json.dumps(_node("7", "CWE-79", "high", 500, "2026-11-09T00:00:00Z")),
        ]))
        market = hacktivity.market_by_class()
        self.assertEqual(market[0]["class_id"], "f9-full-read-ssrf")   # $9000 tops
        xss = next(m for m in market if m["class_id"] == "f16-reflected-xss-non-self")
        self.assertEqual(xss["count"], 2)
        self.assertEqual(xss["max_bounty"], 1500)
        self.assertEqual(xss["paid_count"], 2)

    def test_enrich_not_found(self) -> None:
        self.assertEqual(hacktivity.enrich_disclosure("nope")["status"], "not-found")

    def test_list_filters(self) -> None:
        hacktivity.ingest_jsonl("\n".join([
            json.dumps(_node("8", "CWE-918", "critical", 9000, "2026-11-11T00:00:00Z")),
            json.dumps(_node("9", "CWE-79", "high", 1500, "2026-11-10T00:00:00Z")),
        ]))
        self.assertEqual(len(hacktivity.list_disclosures(severity="critical")), 1)
        self.assertEqual(len(hacktivity.list_disclosures(class_id="f16-reflected-xss-non-self")), 1)
        self.assertEqual(len(hacktivity.list_disclosures(enriched=False)), 2)
        self.assertEqual(len(hacktivity.list_disclosures(enriched=True)), 0)


if __name__ == "__main__":
    unittest.main()
