from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
from importlib.machinery import SourceFileLoader
import tempfile
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).parents[2]
SCRIPT = ROOT / "bin" / "cyberbox-browser"
SPEC = importlib.util.spec_from_loader("cyberbox_browser", SourceFileLoader("cyberbox_browser", str(SCRIPT)))
assert SPEC and SPEC.loader
broker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(broker)


class BrowserBrokerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        home = Path(self.temp.name)
        broker.HOME = home
        broker.POLICY_FILE = home / "policy.json"
        broker.STATE_FILE = home / "state.json"
        broker.AUDIT_FILE = home / "audit.jsonl"
        broker.EVIDENCE_DIR = home / "evidence"
        broker.GENERATION_FILE = home / "generation"
        broker.GENERATION_FILE.write_text("generation-one")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_scope_is_deny_by_default_and_blocks_private_targets(self) -> None:
        policy = broker.default_policy()
        self.assertFalse(broker.target_allowed("https://app.example.com", policy)[0])
        policy["scope"] = ["*.example.com"]
        resolved = [(broker.socket.AF_INET, broker.socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        with mock.patch.object(broker.socket, "getaddrinfo", return_value=resolved):
            self.assertTrue(broker.target_allowed("https://app.example.com/login", policy)[0])
        self.assertFalse(broker.target_allowed("https://outside.test", policy)[0])
        policy["scope"] = ["127.0.0.1"]
        self.assertFalse(broker.target_allowed("http://127.0.0.1:3000", policy)[0])
        policy["allow_private_targets"] = True
        self.assertTrue(broker.target_allowed("http://127.0.0.1:3000", policy)[0])

    def test_scope_blocks_dns_rebinding_to_private_space(self) -> None:
        policy = broker.default_policy()
        policy["scope"] = ["*.example.com"]
        resolved = [(broker.socket.AF_INET, broker.socket.SOCK_STREAM, 6, "", ("169.254.169.254", 443))]
        with mock.patch.object(broker.socket, "getaddrinfo", return_value=resolved):
            allowed, reason = broker.target_allowed("https://metadata.example.com", policy)
        self.assertFalse(allowed)
        self.assertIn("blocked address", reason)

    def test_scope_compiles_to_browser_level_navigation_allowlist(self) -> None:
        policy = broker.default_policy()
        policy["scope"] = ["*.example.com", "accounts.example.net"]
        allowlist = broker.browser_allowlist(policy)
        self.assertIn("https://*.example.com/*", allowlist)
        self.assertIn("http://accounts.example.net/*", allowlist)
        self.assertNotIn("*://*/*", allowlist)

    def test_sensitive_values_are_redacted_from_audit_shape(self) -> None:
        value = broker.sanitize({"selector": "#password", "value": "safe", "text": "visible label",
                                 "authorization": "Bearer abc", "nested": [{"cookie": "x"}]},
                                context="evidence")
        self.assertEqual(value["text"], "visible label")
        self.assertEqual(value["value"], "[REDACTED]")
        self.assertEqual(value["authorization"], "[REDACTED]")
        self.assertEqual(value["nested"][0]["cookie"], "[REDACTED]")

    def test_lease_is_exclusive_hashed_and_generation_bound(self) -> None:
        args = argparse.Namespace(role="attacker", lease_command="acquire", agent="claude-code", ttl=120)
        with contextlib.redirect_stdout(io.StringIO()):
            broker.cmd_lease(args)
        state = broker.load(broker.STATE_FILE, {})
        item = state["leases"]["attacker"]
        self.assertTrue(item["digest"].startswith("sha256:"))
        self.assertNotIn("cblease_", item["digest"])
        self.assertEqual(item["generation"], "generation-one")
        broker.GENERATION_FILE.write_text("generation-two")
        check = argparse.Namespace(role="attacker", lease="not-the-token")
        with self.assertRaises(SystemExit):
            broker.lease(check, state)

    def test_guided_and_balanced_modes_require_mutation_approval(self) -> None:
        policy = broker.default_policy()
        self.assertFalse(broker.approval_required(policy, "navigate"))
        self.assertTrue(broker.approval_required(policy, "click"))
        policy["mode"] = "balanced"
        self.assertTrue(broker.approval_required(policy, "fill"))
        policy["mode"] = "autonomous"
        self.assertFalse(broker.approval_required(policy, "click"))
        self.assertTrue(broker.approval_required(policy, "har"))

    def test_broker_contract_does_not_expose_credentials(self) -> None:
        contract = broker.contract()
        rendered = json.dumps(contract).lower()
        self.assertIn("navigate", contract["actions"])
        self.assertNotIn("api_key", rendered)
        self.assertNotIn("127.0.0.1:8083", rendered)
        self.assertNotIn("9222", rendered)


if __name__ == "__main__":
    unittest.main()
