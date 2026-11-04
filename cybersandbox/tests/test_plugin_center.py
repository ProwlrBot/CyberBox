from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


class PluginCenterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        home = Path(self.temp.name)
        (home / "registry.yaml").write_text(
            "version: 1\npolicy_version: '2026-04-25'\npdtm_tools:\n"
            "  subfinder:\n    repo: projectdiscovery/subfinder\n    install_type: go\n"
            "    go_install_path: github.com/projectdiscovery/subfinder/v2/cmd/subfinder\n"
            "    version: v2.13.0\ncaido_plugins:\n"
            "  signed-caido:\n    type: caido-plugin\n    repo: https://github.com/example/plugin\n"
            "    description: Signed test integration\n    size: 1MB\n    tags: [caido]\n"
            "    release: v1.0.0\n    manifest: caido.json\n"
            "    signature: {method: cosign, issuer: https://token.actions.githubusercontent.com, identity: https://example.test/identity}\n"
            "plugins:\n  hydra-lists:\n    type: wordlist\n"
            "    description: Curated authentication test fixtures\n    size: 1MB\n"
            "    tags: [credentials, lab]\n    repo: https://example.test/lists\n"
            "  ../unsafe:\n    type: tool\n")
        (home / "installed.yaml").write_text(
            "plugins:\n  hydra-lists:\n    type: wordlist\n    path: /tmp/hydra-lists\n")
        os.environ["CSBX_HOME"] = str(home)
        source = Path(__file__).parents[1] / "plugin-center" / "server.py"
        spec = importlib.util.spec_from_file_location("plugin_center_server", source)
        self.module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(self.module)

    def tearDown(self) -> None:
        os.environ.pop("CSBX_HOME", None)
        os.environ.pop("CYBERBOX_CONTROL_PLANE_URL", None)
        self.temp.cleanup()

    def test_state_combines_registry_installs_and_safe_previews(self) -> None:
        state = self.module.state()
        self.assertEqual({item["name"] for item in state["plugins"]},
                         {"hydra-lists", "signed-caido", "subfinder"})
        hydra_lists = next(item for item in state["plugins"] if item["name"] == "hydra-lists")
        self.assertTrue(hydra_lists["installed"])
        self.assertFalse(hydra_lists["pinned"])
        signed = next(item for item in state["plugins"] if item["name"] == "signed-caido")
        self.assertEqual(signed["trust_tier"], "strict")
        self.assertEqual(signed["signature_method"], "cosign")
        self.assertEqual(signed["command"], "csbx install --caido signed-caido")
        pdtm = next(item for item in state["plugins"] if item["name"] == "subfinder")
        self.assertTrue(pdtm["pinned"])
        self.assertEqual(pdtm["command"], "csbx pdtm subfinder")
        self.assertIn("hydra", {item["id"] for item in state["previews"]})
        hydra = next(item for item in state["previews"] if item["id"] == "hydra")
        self.assertIn("scope required", hydra["controls"])
        self.assertIn("<in-scope-target>", hydra["command"])
        self.assertIn("red-team", hydra["profiles"])
        self.assertIn("bug-bounty", state["plugins"][0]["profiles"])
        self.assertIn("blue-team", {profile["id"] for profile in state["profiles"]})
        self.assertIn("malware-analysis", {profile["id"] for profile in state["profiles"]})
        self.assertIn("security-education", {profile["id"] for profile in state["profiles"]})
        preview_ids = {item["id"] for item in state["previews"]}
        self.assertTrue({"nuclei", "ffuf", "httpx", "subfinder", "sigma", "yara"} <= preview_ids)
        for preview in state["previews"]:
            self.assertTrue(preview["profiles"])
            self.assertTrue(preview["command"])
        covered_profiles = {profile for preview in state["previews"] for profile in preview["profiles"]}
        self.assertTrue(set(self.module.PROFILE_TYPES) <= covered_profiles)
        active = next(item for item in state["previews"] if item["id"] == "nuclei")
        self.assertIn("rate limit", active["controls"])
        self.assertIn("<in-scope-url>", active["command"])
        expected = {"dalfox", "arjun", "sqlmap", "jwt-hack", "trufflehog", "gitleaks",
                    "nmap", "mitmproxy", "wafw00f", "commix", "tshark", "metasploit",
                    "shodan", "censys"}
        self.assertTrue(expected <= preview_ids)
        metasploit = next(item for item in state["previews"] if item["id"] == "metasploit")
        self.assertEqual(metasploit["maturity"], "requires configuration")
        self.assertIn("separate provider required", metasploit["controls"])
        for preview in state["previews"]:
            if preview.get("risk") == "approval":
                self.assertIn("approval required", preview["controls"])

    def test_install_plan_exposes_registry_policy_and_trust(self) -> None:
        standard = self.module.install_plan("hydra-lists")
        self.assertTrue(standard["mutable_source"])
        self.assertEqual(standard["policy_version"], "2026-04-25")
        self.assertEqual(standard["command"], "csbx install hydra-lists")
        strict = self.module.install_plan("signed-caido")
        self.assertEqual(strict["trust_tier"], "strict")
        self.assertEqual(strict["signature"]["method"], "cosign")
        with self.assertRaises(ValueError):
            self.module.install_plan("../unsafe")

    def test_health_reports_ready_and_degraded_components_honestly(self) -> None:
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_args): return None

        processes = "\n".join(
            f"{process} RUNNING pid 1" for process, _url in self.module.SERVICE_COMPONENTS.values())
        ready = self.module.health(
            opener=lambda *_args, **_kwargs: Response(),
            runner=lambda *_args, **_kwargs: SimpleNamespace(returncode=0, stdout=processes),
            finder=lambda _command: "/usr/bin/tool",
            disk_usage=lambda _path: SimpleNamespace(total=100, used=40),
        )
        self.assertEqual(ready["state"], "Ready")
        self.assertEqual(ready["summary"]["attention"], 0)

        degraded = self.module.health(
            opener=lambda *_args, **_kwargs: Response(),
            runner=lambda *_args, **_kwargs: SimpleNamespace(returncode=0, stdout="nginx RUNNING pid 1"),
            finder=lambda command: None if command == "nuclei" else "/usr/bin/tool",
            disk_usage=lambda _path: SimpleNamespace(total=100, used=91),
        )
        self.assertEqual(degraded["state"], "Degraded")
        states = {item["id"]: item["state"] for item in degraded["components"]}
        self.assertEqual(states["browser"], "Unavailable")
        self.assertEqual(states["toolchain"], "Missing dependency")
        self.assertEqual(states["storage"], "Degraded")

    def test_runtime_reports_cgroup_limits_and_tool_versions(self) -> None:
        values = {"memory.current": "250", "memory.max": "1000", "cpu.max": "200000 100000",
                  "pids.current": "12", "pids.max": "2048"}
        report = self.module.runtime(
            reader=lambda name: values[name],
            runner=lambda command, **_kwargs: SimpleNamespace(
                returncode=0, stdout=f"{command[0]} version 1.0\n", stderr=""),
            finder=lambda command: f"/usr/bin/{command}",
        )
        self.assertEqual(report["resources"]["memory_percent"], 25.0)
        self.assertEqual(report["resources"]["cpu_limit"], 2.0)
        self.assertEqual(report["resources"]["pids_limit"], 2048)
        self.assertTrue(all(tool["state"] == "Ready" for tool in report["tools"]))
        self.assertEqual(self.module._version_line(
            "  __ banner __\n[\x1b[34mINF\x1b[0m] Current Version: v1.9.0\n"),
            "[INF] Current Version: v1.9.0")

    def test_database_health_is_preview_ready_or_degraded(self) -> None:
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_args): return None

        processes = "\n".join(
            f"{process} RUNNING pid 1" for process, _url in self.module.SERVICE_COMPONENTS.values())
        arguments = {
            "opener": lambda *_args, **_kwargs: Response(),
            "runner": lambda *_args, **_kwargs: SimpleNamespace(returncode=0, stdout=processes),
            "finder": lambda command: f"/usr/bin/{command}",
            "disk_usage": lambda _path: SimpleNamespace(total=100, used=20),
        }
        missing = self.module.health(
            **arguments, database_path=Path(self.temp.name) / "missing.db")
        database = next(item for item in missing["components"] if item["id"] == "database")
        self.assertEqual(database["state"], "Preview")
        self.assertEqual(missing["state"], "Ready")
        self.assertEqual(missing["summary"]["preview"], 2)

        valid_path = Path(self.temp.name) / "valid.db"
        with sqlite3.connect(valid_path) as connection:
            connection.execute("CREATE TABLE health (id INTEGER PRIMARY KEY)")
        valid = self.module.health(**arguments, database_path=valid_path)
        database = next(item for item in valid["components"] if item["id"] == "database")
        self.assertEqual(database["state"], "Ready")

        corrupt_path = Path(self.temp.name) / "corrupt.db"
        corrupt_path.write_bytes(b"not a sqlite database")
        corrupt = self.module.health(**arguments, database_path=corrupt_path)
        database = next(item for item in corrupt["components"] if item["id"] == "database")
        self.assertEqual(database["state"], "Degraded")
        self.assertEqual(corrupt["state"], "Degraded")

        class DeniedPath:
            def exists(self):
                raise PermissionError("denied")

        denied = self.module.health(**arguments, database_path=DeniedPath())
        database = next(item for item in denied["components"] if item["id"] == "database")
        self.assertEqual(database["state"], "Degraded")
        self.assertIn("not accessible", database["cause"])

    def test_control_plane_health_is_capability_gated(self) -> None:
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_args): return None

        processes = "\n".join(
            f"{process} RUNNING pid 1" for process, _url in self.module.SERVICE_COMPONENTS.values())
        arguments = {
            "runner": lambda *_args, **_kwargs: SimpleNamespace(returncode=0, stdout=processes),
            "finder": lambda command: f"/usr/bin/{command}",
            "disk_usage": lambda _path: SimpleNamespace(total=100, used=20),
            "database_path": Path(self.temp.name) / "missing.db",
        }
        preview = self.module.health(opener=lambda *_args, **_kwargs: Response(), **arguments)
        control = next(item for item in preview["components"] if item["id"] == "control-plane")
        self.assertEqual(control["state"], "Preview")

        os.environ["CYBERBOX_CONTROL_PLANE_URL"] = "http://control-plane:8787/health"
        ready = self.module.health(opener=lambda *_args, **_kwargs: Response(), **arguments)
        control = next(item for item in ready["components"] if item["id"] == "control-plane")
        self.assertEqual(control["state"], "Ready")

        unavailable = self.module.health(
            opener=lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("down")), **arguments)
        control = next(item for item in unavailable["components"] if item["id"] == "control-plane")
        self.assertEqual(control["state"], "Unavailable")
        self.assertEqual(unavailable["state"], "Degraded")

    def test_recovery_capability_is_same_origin_and_logs_are_redacted(self) -> None:
        headers = {"Host": "127.0.0.1:8082", "Origin": "http://127.0.0.1:8082",
                   "Cookie": f"other=x; cbx_cap={self.module.CAPABILITY}"}
        self.assertTrue(self.module._authorized(headers))
        self.assertFalse(self.module._authorized({**headers, "Origin": "https://evil.test"}))
        self.assertFalse(self.module._authorized({**headers, "Cookie": "cbx_cap=wrong"}))
        fetch_headers = {"Host": "127.0.0.1:8082", "Origin": "", "Sec-Fetch-Site": "same-origin",
                         "Cookie": f"cbx_cap={self.module.CAPABILITY}"}
        self.assertTrue(self.module._authorized(fetch_headers))
        self.assertFalse(self.module._authorized({**fetch_headers, "Sec-Fetch-Site": "cross-site"}))
        redacted = self.module._redact("authorization: Bearer-secret token=abc123 safe")
        self.assertNotIn("Bearer-secret", redacted)
        self.assertNotIn("abc123", redacted)
        self.assertIn("[REDACTED]", redacted)
        self.assertEqual(
            self.module.RECOVERABLE_SERVICES["terminal"],
            ("python-server", "/var/log/gem/python-server.log"),
        )
        self.assertEqual(self.module.SERVICE_COMPONENTS["terminal"][0], "python-server")

    def test_capture_evidence_uses_internal_bridge_and_provider_token(self) -> None:
        self.module.INTERNAL_SERVICE_TOKEN = ""
        disabled = self.module.capture_evidence("project-1", "Title", "content", {})
        self.assertFalse(disabled["ok"])
        self.assertIn("disabled", disabled["error"])

        calls = []

        class Response:
            def __init__(self, payload):
                self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *_args): return None
            def read(self): return json.dumps(self.payload).encode()

        def opener(request, timeout=0):
            calls.append({
                "url": request.full_url,
                "headers": dict(request.header_items()),
                "body": json.loads(request.data.decode()),
                "timeout": timeout,
            })
            if request.full_url.endswith("/internal/projects/project-1/capabilities"):
                return Response({"token": "cbcap_test", "id": "capability-1"})
            if request.full_url.endswith("/provider/projects/project-1/artifacts"):
                return Response({"id": "artifact-1", "kind": "plugin-center-note"})
            raise AssertionError(request.full_url)

        self.module.INTERNAL_SERVICE_TOKEN = "cbin_test"
        result = self.module.capture_evidence(
            "project-1", "Title", "content", {"panel": "plugin-center"}, opener)

        self.assertTrue(result["ok"])
        self.assertEqual(result["artifact"]["id"], "artifact-1")
        self.assertEqual(calls[0]["headers"]["X-cyberbox-internal-token"], "cbin_test")
        self.assertEqual(calls[0]["body"]["permissions"], ["evidence.write"])
        self.assertEqual(calls[1]["headers"]["X-cyberbox-capability"], "cbcap_test")
        self.assertEqual(calls[1]["body"]["kind"], "plugin-center-note")

    def test_registry_sync_requires_control_plane_capability(self) -> None:
        self.module.INTERNAL_SERVICE_TOKEN = ""
        disabled = self.module.authorize_registry_sync()
        self.assertFalse(disabled["ok"])
        self.assertIn("disabled", disabled["error"])

        calls = []

        class Response:
            def __init__(self, payload):
                self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *_args): return None
            def read(self): return json.dumps(self.payload).encode()

        def opener(request, timeout=0):
            calls.append({
                "url": request.full_url,
                "headers": dict(request.header_items()),
                "body": json.loads(request.data.decode()),
            })
            if request.full_url.endswith("/internal/capabilities"):
                return Response({"token": "cbcap_sync", "project_id": "cyberbox-system"})
            if request.full_url.endswith("/internal/capabilities/verify"):
                return Response({"ok": True, "capability": {"id": "capability-sync"}})
            raise AssertionError(request.full_url)

        self.module.INTERNAL_SERVICE_TOKEN = "cbin_test"
        result = self.module.authorize_registry_sync(opener)

        self.assertTrue(result["ok"])
        self.assertEqual(result["capability_id"], "capability-sync")
        self.assertEqual(calls[0]["body"]["permissions"], ["plugin.registry.sync"])
        self.assertEqual(calls[1]["body"]["permission"], "plugin.registry.sync")
        self.assertEqual(calls[1]["headers"]["X-cyberbox-internal-token"], "cbin_test")

    def test_service_restart_requires_control_plane_capability(self) -> None:
        self.module.INTERNAL_SERVICE_TOKEN = ""
        disabled = self.module.authorize_service_restart()
        self.assertFalse(disabled["ok"])
        self.assertIn("disabled", disabled["error"])

        calls = []

        class Response:
            def __init__(self, payload):
                self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *_args): return None
            def read(self): return json.dumps(self.payload).encode()

        def opener(request, timeout=0):
            calls.append({
                "url": request.full_url,
                "headers": dict(request.header_items()),
                "body": json.loads(request.data.decode()),
            })
            if request.full_url.endswith("/internal/capabilities"):
                return Response({"token": "cbcap_restart", "project_id": "cyberbox-system"})
            if request.full_url.endswith("/internal/capabilities/verify"):
                return Response({"ok": True, "capability": {"id": "capability-restart"}})
            raise AssertionError(request.full_url)

        self.module.INTERNAL_SERVICE_TOKEN = "cbin_test"
        result = self.module.authorize_service_restart(opener)

        self.assertTrue(result["ok"])
        self.assertEqual(result["capability_id"], "capability-restart")
        self.assertEqual(calls[0]["body"]["permissions"], ["service.restart"])
        self.assertEqual(calls[1]["body"]["permission"], "service.restart")
        self.assertEqual(calls[1]["headers"]["X-cyberbox-internal-token"], "cbin_test")

    def test_service_logs_requires_control_plane_capability(self) -> None:
        self.module.INTERNAL_SERVICE_TOKEN = ""
        disabled = self.module.authorize_service_logs()
        self.assertFalse(disabled["ok"])
        self.assertIn("disabled", disabled["error"])

        calls = []

        class Response:
            def __init__(self, payload):
                self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *_args): return None
            def read(self): return json.dumps(self.payload).encode()

        def opener(request, timeout=0):
            calls.append({
                "url": request.full_url,
                "headers": dict(request.header_items()),
                "body": json.loads(request.data.decode()),
            })
            if request.full_url.endswith("/internal/capabilities"):
                return Response({"token": "cbcap_logs", "project_id": "cyberbox-system"})
            if request.full_url.endswith("/internal/capabilities/verify"):
                return Response({"ok": True, "capability": {"id": "capability-logs"}})
            raise AssertionError(request.full_url)

        self.module.INTERNAL_SERVICE_TOKEN = "cbin_test"
        result = self.module.authorize_service_logs(opener)

        self.assertTrue(result["ok"])
        self.assertEqual(result["capability_id"], "capability-logs")
        self.assertEqual(calls[0]["body"]["permissions"], ["service.read"])
        self.assertEqual(calls[1]["body"]["permission"], "service.read")
        self.assertEqual(calls[1]["headers"]["X-cyberbox-internal-token"], "cbin_test")

    def test_runtime_noise_filter_collapses_repetitive_container_chatter(self) -> None:
        lines = [
            "Starting browser...",
            "[1:2] ERROR: bus.cc(408) Failed to connect to the bus",
            "DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc",
            "Registration response error message: DEPRECATED_ENDPOINT",
            "browser ready",
        ]
        filtered, noise = self.module._filter_runtime_noise(lines)
        self.assertEqual(noise, 3)
        self.assertEqual(filtered, ["Starting browser...", "browser ready"])


if __name__ == "__main__":
    unittest.main()
