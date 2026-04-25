"""Unit tests for phase_recon, cve_lookup, and triage_writer."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cve_lookup import (  # noqa: E402  (path manipulated above)
    CVERecord,
    TargetReport,
    group_by_severity,
    query_cves,
    severity_for,
)
from phase_recon import (  # noqa: E402
    build_target_report,
    parse_httpx_targets,
    parse_tech_string,
    run_phase_recon,
)
from triage_writer import (  # noqa: E402
    append_to_triage,
    render_cve,
    render_target,
)


# ──────────────────────────────────────────────────────────────────
# Fake nvdlib module for dependency injection.
#
# Returning bare SimpleNamespace objects mirrors nvdlib's actual API
# closely enough — _normalise() reads attributes via getattr().
# ──────────────────────────────────────────────────────────────────

def _fake_nvd(scenarios):
    """Build a fake nvdlib module driven by `scenarios`, a dict mapping
    `keywordSearch` substrings to lists of fake CVE objects.

    Anything not matched returns []."""

    class _Fake:
        searchCVE_calls = []

        @staticmethod
        def searchCVE(keywordSearch, key=None, delay=None):
            _Fake.searchCVE_calls.append({
                "keywordSearch": keywordSearch,
                "key": key,
                "delay": delay,
            })
            for substr, cves in scenarios.items():
                if substr in keywordSearch:
                    return iter(cves)
            return iter([])

    return _Fake


def _fake_cve(cve_id, score, severity=None, vector=None, description=""):
    return SimpleNamespace(
        id=cve_id,
        v31score=score,
        v31severity=severity,
        v31vector=vector,
        descriptions=[SimpleNamespace(value=description)] if description else [],
    )


# ──────────────────────────────────────────────────────────────────
# parse_tech_string
# ──────────────────────────────────────────────────────────────────


class TestParseTechString(unittest.TestCase):
    def test_versioned_tech(self):
        self.assertEqual(parse_tech_string("nginx-1.18.0"), ("nginx", "1.18.0"))
        self.assertEqual(parse_tech_string("wordpress-5.8"), ("wordpress", "5.8"))
        self.assertEqual(parse_tech_string("jquery-3.6.1"), ("jquery", "3.6.1"))

    def test_unversioned_tech(self):
        self.assertEqual(parse_tech_string("wordpress"), ("wordpress", None))
        self.assertEqual(parse_tech_string("apache"), ("apache", None))

    def test_no_trailing_version(self):
        # "x-frame-deny" looks like a version on the surface but `deny`
        # is not numeric, so it should fall through to unversioned.
        self.assertEqual(parse_tech_string("x-frame-deny"), ("x-frame-deny", None))

    def test_whitespace_stripped(self):
        self.assertEqual(parse_tech_string("  nginx-1.18.0  "), ("nginx", "1.18.0"))


# ──────────────────────────────────────────────────────────────────
# parse_httpx_targets
# ──────────────────────────────────────────────────────────────────


class TestParseHttpxTargets(unittest.TestCase):
    def test_well_formed(self):
        lines = [
            json.dumps({"url": "https://a.example", "technologies": ["nginx-1.18.0"]}),
            json.dumps({"url": "https://b.example", "tech": ["wordpress-5.8"]}),
        ]
        targets = parse_httpx_targets(lines)
        self.assertEqual(len(targets), 2)
        self.assertEqual(targets[0]["url"], "https://a.example")
        self.assertEqual(targets[0]["technologies"], ["nginx-1.18.0"])
        # `tech` field accepted as alias of `technologies`
        self.assertEqual(targets[1]["technologies"], ["wordpress-5.8"])

    def test_malformed_line_skipped(self):
        lines = [
            "not json at all",
            json.dumps({"url": "https://a.example", "technologies": ["nginx-1.18.0"]}),
        ]
        targets = parse_httpx_targets(lines)
        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0]["url"], "https://a.example")

    def test_missing_url_skipped(self):
        lines = [
            json.dumps({"technologies": ["nginx-1.18.0"]}),  # no url
            json.dumps({"url": "https://b.example", "technologies": ["wordpress-5.8"]}),
        ]
        targets = parse_httpx_targets(lines)
        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0]["url"], "https://b.example")

    def test_non_list_technologies_skipped(self):
        lines = [
            json.dumps({"url": "https://a.example", "technologies": "nginx"}),
            json.dumps({"url": "https://b.example", "technologies": ["nginx-1.18.0"]}),
        ]
        targets = parse_httpx_targets(lines)
        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0]["url"], "https://b.example")

    def test_blank_lines_ignored(self):
        lines = ["", "   ", json.dumps({"url": "https://a.example", "technologies": []})]
        targets = parse_httpx_targets(lines)
        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0]["technologies"], [])

    def test_non_string_techs_filtered(self):
        # httpx sometimes emits objects under tech for richer detection;
        # filter those out so downstream string ops don't crash.
        lines = [json.dumps({
            "url": "https://a.example",
            "technologies": ["nginx-1.18.0", {"name": "wordpress"}, None, ""],
        })]
        targets = parse_httpx_targets(lines)
        self.assertEqual(targets[0]["technologies"], ["nginx-1.18.0"])


# ──────────────────────────────────────────────────────────────────
# severity_for and CVERecord
# ──────────────────────────────────────────────────────────────────


class TestSeverityMapping(unittest.TestCase):
    def test_thresholds(self):
        self.assertEqual(severity_for(9.8), "CRITICAL")
        self.assertEqual(severity_for(9.0), "CRITICAL")
        self.assertEqual(severity_for(7.5), "HIGH")
        self.assertEqual(severity_for(7.0), "HIGH")
        self.assertEqual(severity_for(4.0), "MEDIUM")
        self.assertEqual(severity_for(2.0), "LOW")
        self.assertEqual(severity_for(0.1), "LOW")

    def test_none_score(self):
        self.assertEqual(severity_for(None), "UNKNOWN")

    def test_zero_score(self):
        self.assertEqual(severity_for(0.0), "NONE")


class TestCVERecord(unittest.TestCase):
    def test_is_critical(self):
        crit = CVERecord(cve_id="CVE-x", cvss_score=9.5, severity="CRITICAL")
        self.assertTrue(crit.is_critical)

        high = CVERecord(cve_id="CVE-y", cvss_score=8.0, severity="HIGH")
        self.assertFalse(high.is_critical)

        unknown = CVERecord(cve_id="CVE-z", cvss_score=None, severity="UNKNOWN")
        self.assertFalse(unknown.is_critical)


# ──────────────────────────────────────────────────────────────────
# query_cves with injected fake nvdlib
# ──────────────────────────────────────────────────────────────────


class TestQueryCves(unittest.TestCase):
    def test_known_vulnerable_returns_records(self):
        fake = _fake_nvd({
            "nginx 1.18.0": [
                _fake_cve("CVE-2021-23017", 9.8, "CRITICAL",
                          "CVSS:3.1/AV:N", "nginx HTTP request smuggling"),
            ],
        })
        cves = query_cves("nginx", "1.18.0", api_key="x", nvdlib_module=fake)
        self.assertEqual(len(cves), 1)
        self.assertEqual(cves[0].cve_id, "CVE-2021-23017")
        self.assertEqual(cves[0].cvss_score, 9.8)
        self.assertEqual(cves[0].severity, "CRITICAL")

    def test_no_results_returns_empty_list(self):
        fake = _fake_nvd({})
        self.assertEqual(query_cves("obscure", "0.0.1", nvdlib_module=fake), [])

    def test_delay_with_key_is_short(self):
        fake = _fake_nvd({"nginx 1.18.0": []})
        query_cves("nginx", "1.18.0", api_key="present", nvdlib_module=fake)
        self.assertEqual(fake.searchCVE_calls[-1]["delay"], 1.2)

    def test_delay_without_key_is_long(self):
        fake = _fake_nvd({"nginx 1.18.0": []})
        query_cves("nginx", "1.18.0", api_key=None, nvdlib_module=fake)
        # If the caller didn't pass an env var either, fallback to 6.0
        with patch.dict(os.environ, {}, clear=True):
            query_cves("nginx", "1.18.0", api_key=None, nvdlib_module=fake)
        # Most recent call must have used the long delay
        self.assertEqual(fake.searchCVE_calls[-1]["delay"], 6.0)

    def test_missing_cvssv3_normalised_as_unknown(self):
        # Older CVE without CVSSv3 score
        fake = _fake_nvd({
            "wordpress 4.0": [
                _fake_cve("CVE-2014-9034", None, None, None, "WordPress 4.0 issue"),
            ],
        })
        cves = query_cves("wordpress", "4.0", api_key="x", nvdlib_module=fake)
        self.assertEqual(len(cves), 1)
        self.assertEqual(cves[0].severity, "UNKNOWN")
        self.assertIsNone(cves[0].cvss_score)

    def test_retry_then_success(self):
        # Fake that raises once, then returns. We verify the retry path
        # eventually returns []; lookup wraps everything in try/except and
        # logs, then proceeds. Permanent failures yield [].
        attempts = {"n": 0}

        def flaky_search(keywordSearch, key=None, delay=None):
            attempts["n"] += 1
            raise RuntimeError("transient")

        fake = SimpleNamespace(searchCVE=flaky_search)
        with patch("cve_lookup.time.sleep"):
            cves = query_cves("nginx", "1.18.0", api_key="x", nvdlib_module=fake)
        self.assertEqual(cves, [])
        self.assertEqual(attempts["n"], 3)  # MAX_RETRIES


# ──────────────────────────────────────────────────────────────────
# group_by_severity + TargetReport priority
# ──────────────────────────────────────────────────────────────────


class TestPrioritization(unittest.TestCase):
    def _cve(self, score, severity):
        return CVERecord(cve_id=f"CVE-{score}", cvss_score=score, severity=severity)

    def test_critical_target(self):
        cves = [self._cve(9.8, "CRITICAL"), self._cve(7.5, "HIGH")]
        grouped = group_by_severity(cves)
        report = TargetReport(url="https://x", technologies=[], cves_by_severity=grouped)
        self.assertEqual(report.priority, "CRITICAL")
        self.assertEqual(report.critical_count, 1)

    def test_no_critical_no_priority(self):
        cves = [self._cve(7.5, "HIGH"), self._cve(4.0, "MEDIUM")]
        report = TargetReport(
            url="https://x",
            technologies=[],
            cves_by_severity=group_by_severity(cves),
        )
        self.assertEqual(report.priority, "NORMAL")
        self.assertEqual(report.critical_count, 0)

    def test_grouping_drops_empty_buckets(self):
        cves = [self._cve(9.8, "CRITICAL"), self._cve(7.5, "HIGH")]
        grouped = group_by_severity(cves)
        self.assertIn("CRITICAL", grouped)
        self.assertIn("HIGH", grouped)
        self.assertNotIn("MEDIUM", grouped)
        self.assertNotIn("LOW", grouped)

    def test_unknown_bucket_collected(self):
        cves = [CVERecord(cve_id="CVE-old", cvss_score=None, severity="UNKNOWN")]
        grouped = group_by_severity(cves)
        self.assertIn("UNKNOWN", grouped)
        self.assertEqual(len(grouped["UNKNOWN"]), 1)


# ──────────────────────────────────────────────────────────────────
# Triage markdown shape + atomic append
# ──────────────────────────────────────────────────────────────────


class TestTriageRendering(unittest.TestCase):
    def test_render_cve_includes_score(self):
        cve = CVERecord(
            cve_id="CVE-2021-23017",
            cvss_score=9.8,
            severity="CRITICAL",
            vector="CVSS:3.1/AV:N",
            description="nginx HTTP request smuggling. Long-extra-text.",
        )
        rendered = render_cve(cve)
        self.assertIn("CVE-2021-23017", rendered)
        self.assertIn("CVSS 9.8", rendered)
        self.assertIn("nginx HTTP request smuggling", rendered)
        # Trailing "Long-extra-text" should be trimmed off
        self.assertNotIn("Long-extra-text", rendered)
        self.assertIn("CVSS:3.1/AV:N", rendered)

    def test_render_target_critical(self):
        cve = CVERecord(cve_id="CVE-x", cvss_score=9.8, severity="CRITICAL")
        report = TargetReport(
            url="https://x.example",
            technologies=["nginx-1.18.0"],
            cves_by_severity={"CRITICAL": [cve]},
        )
        rendered = render_target(report)
        self.assertIn("https://x.example", rendered)
        self.assertIn("nginx-1.18.0", rendered)
        self.assertIn("CRITICAL", rendered)
        self.assertIn("🔴", rendered)
        self.assertIn("Auto-prioritized", rendered)

    def test_render_target_no_cves(self):
        report = TargetReport(
            url="https://x.example",
            technologies=["wordpress"],
            cves_by_severity={},
        )
        rendered = render_target(report)
        self.assertIn("No known CVEs", rendered)
        self.assertIn("NORMAL", rendered)


class TestAtomicAppend(unittest.TestCase):
    def test_creates_file_with_header(self):
        with tempfile.TemporaryDirectory() as td:
            triage = Path(td) / "triage.md"
            cve = CVERecord(cve_id="CVE-x", cvss_score=9.8, severity="CRITICAL")
            report = TargetReport(
                url="https://x.example",
                technologies=["nginx-1.18.0"],
                cves_by_severity={"CRITICAL": [cve]},
            )
            append_to_triage(triage, [report])
            content = triage.read_text()
            self.assertIn("# Reconnaissance Triage Report", content)
            self.assertIn("https://x.example", content)
            self.assertIn("CVE-x", content)

    def test_append_does_not_duplicate_header(self):
        with tempfile.TemporaryDirectory() as td:
            triage = Path(td) / "triage.md"
            cve = CVERecord(cve_id="CVE-x", cvss_score=9.8, severity="CRITICAL")
            report = TargetReport(
                url="https://x.example",
                technologies=[],
                cves_by_severity={"CRITICAL": [cve]},
            )
            append_to_triage(triage, [report])
            append_to_triage(triage, [report])
            content = triage.read_text()
            # Header should appear exactly once
            self.assertEqual(content.count("# Reconnaissance Triage Report"), 1)
            # Target section appears twice (one per append)
            self.assertEqual(content.count("https://x.example"), 2)

    def test_no_temp_file_left_on_success(self):
        with tempfile.TemporaryDirectory() as td:
            triage = Path(td) / "triage.md"
            report = TargetReport(url="https://x", technologies=[], cves_by_severity={})
            append_to_triage(triage, [report])
            leftover = list(Path(td).glob(".triage-*.tmp"))
            self.assertEqual(leftover, [])


# ──────────────────────────────────────────────────────────────────
# End-to-end run_phase_recon with mocked nvdlib
# ──────────────────────────────────────────────────────────────────


class TestRunPhaseRecon(unittest.TestCase):
    def test_full_pipeline_writes_markdown(self):
        with tempfile.TemporaryDirectory() as td:
            httpx_path = Path(td) / "httpx.json"
            triage_path = Path(td) / "triage.md"
            httpx_path.write_text("\n".join([
                json.dumps({"url": "https://a.example",
                            "technologies": ["nginx-1.18.0", "jquery-3.6.0"]}),
                json.dumps({"url": "https://b.example",
                            "technologies": ["wordpress-5.8"]}),
                "",
                json.dumps({"url": "https://c.example", "technologies": ["bare-tech"]}),
            ]))

            fake = _fake_nvd({
                "nginx 1.18.0": [_fake_cve("CVE-2021-23017", 9.8, "CRITICAL",
                                            "CVSS:3.1/AV:N", "nginx smuggling")],
                "jquery 3.6.0": [_fake_cve("CVE-2020-11023", 6.1, "MEDIUM",
                                            "CVSS:3.1/AV:N", "jquery XSS")],
                "wordpress 5.8": [_fake_cve("CVE-2021-29447", 7.5, "HIGH",
                                             "CVSS:3.1/AV:N", "WP xxe")],
            })

            reports = run_phase_recon(
                httpx_path,
                triage_path,
                api_key="x",
                nvdlib_module=fake,
            )

            self.assertEqual(len(reports), 3)
            urls = {r.url for r in reports}
            self.assertEqual(urls,
                             {"https://a.example", "https://b.example", "https://c.example"})

            critical = [r for r in reports if r.priority == "CRITICAL"]
            self.assertEqual(len(critical), 1)
            self.assertEqual(critical[0].url, "https://a.example")

            content = triage_path.read_text()
            self.assertIn("CVE-2021-23017", content)
            self.assertIn("CVE-2020-11023", content)
            self.assertIn("CVE-2021-29447", content)
            # bare-tech was skipped (no version) so its target reports no CVEs
            self.assertIn("https://c.example", content)
            self.assertIn("No known CVEs", content)


if __name__ == "__main__":
    unittest.main()
