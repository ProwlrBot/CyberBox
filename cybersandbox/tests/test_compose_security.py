from __future__ import annotations

import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).parents[2]


class ComposeSecurityTest(unittest.TestCase):
    def load(self, path: Path) -> dict:
        return yaml.safe_load(path.read_text())

    def assert_runtime_baseline(self, service: dict) -> None:
        self.assertTrue(service.get("init"), "container init must reap child processes")
        self.assertGreater(service.get("pids_limit", 0), 0, "PID limit must be bounded")
        security = service.get("security_opt", [])
        self.assertIn("no-new-privileges:true", security)
        self.assertNotIn("seccomp:unconfined", security)
        self.assertFalse(service.get("privileged", False))

    def test_root_compose_is_local_first_and_seccomp_confined(self) -> None:
        service = self.load(ROOT / "docker-compose.yaml")["services"]["sandbox"]
        self.assert_runtime_baseline(service)
        self.assertNotIn("container_name", service)
        ports = service["ports"]
        self.assertTrue(any("127.0.0.1" in item for item in ports), ports)
        self.assertEqual(service["environment"]["WORKSPACE"], '${WORKSPACE:-"/home/hunter"}')
        self.assertIn("cyberbox-workspace:/home/hunter", service["volumes"])

    def test_primary_launcher_targets_docker_workstation(self) -> None:
        launcher = (ROOT / "bin" / "cyberbox").read_text()
        self.assertIn("docker compose", launcher)
        self.assertIn("/csbx/api/health", launcher)
        self.assertIn('platform)', launcher)
        self.assertNotIn("8787", launcher)

    def test_control_plane_is_internal_and_constrained(self) -> None:
        compose = self.load(ROOT / "docker-compose.yaml")
        service = compose["services"]["control-plane"]
        self.assert_runtime_baseline(service)
        self.assertTrue(service["read_only"])
        self.assertEqual(service["cap_drop"], ["ALL"])
        self.assertNotIn("ports", service)
        self.assertEqual(service["expose"], ["8787"])
        self.assertIn("cyberbox-control:/data", service["volumes"])
        sandbox = compose["services"]["sandbox"]
        self.assertIn("nginx-control.conf", " ".join(sandbox["volumes"]))

    def test_development_compose_has_explicit_runtime_bounds(self) -> None:
        service = self.load(ROOT / "cybersandbox" / "docker-compose.dev.yml")["services"]["cybersandbox"]
        self.assert_runtime_baseline(service)
        self.assertEqual(service["ports"], ["127.0.0.1:8082:8080"])
        self.assertEqual(set(service.get("cap_add", [])), {"NET_RAW", "NET_ADMIN"})
        self.assertTrue(any("workspace-migrate.sh" in mount for mount in service["volumes"]))

    def test_browser_hunt_roles_are_local_and_identity_isolated(self) -> None:
        compose = self.load(ROOT / "docker-compose.browser-hunt.yaml")
        attacker = compose["services"]["attacker-browser"]
        victim = compose["services"]["victim-browser"]
        for service in (attacker, victim):
            self.assert_runtime_baseline({**compose["x-browser-hunt-service"], **service})
            self.assertTrue(all(port.startswith("127.0.0.1:") for port in service["ports"]))
            self.assertFalse(any(port.endswith(":8100") for port in service["ports"]))
            self.assertIn("SANDBOX_API_KEY", service["environment"])
        self.assertNotEqual(attacker["volumes"], victim["volumes"])
        self.assertNotEqual(attacker["networks"], victim["networks"])
        self.assertEqual(attacker["environment"]["CYBERBOX_BROWSER_ROLE"], "attacker")
        self.assertEqual(victim["environment"]["CYBERBOX_BROWSER_ROLE"], "victim")

    def test_browser_hunt_launcher_prints_agent_neutral_connectors(self) -> None:
        launcher = (ROOT / "bin" / "cyberbox").read_text()
        self.assertIn("browser-hunt", launcher)
        self.assertIn("browser lease acquire", launcher)
        self.assertIn("agent-step --provider claude", launcher)
        self.assertIn("agent-step --provider ollama", launcher)
        self.assertIn("ensure_browser_hunt_tokens", launcher)

    def test_openshell_policy_only_reaches_the_gated_broker(self) -> None:
        policy = self.load(ROOT / "openshell" / "browser-agent-policy.yaml")
        rules = policy["network_policies"]
        self.assertEqual(set(rules), {"cyberbox_browser_broker"})
        endpoint = rules["cyberbox_browser_broker"]["endpoints"][0]
        self.assertEqual(endpoint["port"], 17890)
        self.assertEqual(endpoint["protocol"], "rest")
        self.assertEqual(endpoint["enforcement"], "enforce")
        paths = {item["allow"]["path"] for item in endpoint["rules"]}
        self.assertEqual(paths, {"/health", "/v1/contract", "/v1/action"})

    def test_image_ci_runs_the_started_workstation_smoke_suite(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "cybersandbox-build.yml").read_text()
        smoke = (ROOT / "cybersandbox" / "tests" / "runtime_smoke.sh").read_text()
        self.assertIn("sh cybersandbox/tests/runtime_smoke.sh cybersandbox:ci", workflow)
        self.assertIn('CYBERBOX_BROWSER_SMOKE: "1"', workflow)
        self.assertIn("playwright install chromium", workflow)
        self.assertIn("/opt/cybersandbox/healthcheck.sh", smoke)
        self.assertIn("/csbx/api/health", smoke)
        self.assertIn("Singleton", smoke)
        self.assertIn("dashboard_smoke.mjs", smoke)
        integration = (ROOT / "cybersandbox" / "plugin-center" / "integrate_dashboard.py").read_text()
        self.assertIn('id="cyberbox-favicon"', integration)
        healthcheck = (ROOT / "cybersandbox" / "healthcheck.sh").read_text()
        self.assertIn("cyberbox-dashboard-ready", healthcheck)

    def test_core_image_has_no_moving_metasploit_installer(self) -> None:
        dockerfile = (ROOT / "cybersandbox" / "Dockerfile").read_text()
        self.assertNotIn("msfupdate.erb", dockerfile)
        self.assertNotIn("/tmp/msfinstall", dockerfile)


if __name__ == "__main__":
    unittest.main()
