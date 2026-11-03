from __future__ import annotations

import asyncio
import tempfile
import unittest
import uuid
from pathlib import Path

from starlette.websockets import WebSocketDisconnect

from cyberbox import auth, db
from cyberbox.app import health as app_health, ws_endpoint
from cyberbox.config import Settings
from cyberbox.routers import api
from cyberbox.services import artifacts, bundles, capabilities, executions, knowledge, memory, playbooks, policy, profiles, project_templates, research


class FoundationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        settings = Settings(home=Path(self.temp.name))
        settings.ensure_dirs()
        import cyberbox.config as config
        config._settings = settings
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        db.init_db()
        profiles.seed()
        playbooks.seed()
        project_templates.seed()
        self.project_id = str(uuid.uuid4())
        self.user_id = str(uuid.uuid4())
        db.insert("users", {"id": self.user_id, "email": f"{self.user_id}@test.local",
                            "name": "Tester", "role": "admin", "api_key": f"cbx_{self.user_id}",
                            "created_at": "now"})
        db.insert("projects", {"id": self.project_id, "slug": self.project_id,
                               "name": "Test", "description": "", "created_at": "now"})

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _engagement(self, autonomy: str = "balanced") -> str:
        engagement_id = str(uuid.uuid4())
        db.insert("engagements", {
            "id": engagement_id, "project_id": self.project_id, "name": "Authorized",
            "profile_id": "bug-bounty", "autonomy": autonomy, "status": "active",
            "scope_version": 1, "budget": "{}", "policy": "{}", "starts_at": None,
            "ends_at": None, "created_by": None, "created_at": "now",
        })
        db.insert("scope_rules_v2", {
            "id": str(uuid.uuid4()), "engagement_id": engagement_id, "effect": "include",
            "resource_type": "domain", "pattern": "*.example.com", "ports": "[443]",
            "methods": '["GET"]', "max_requests_min": 60, "active": 1, "created_at": "now",
        })
        return engagement_id

    def test_policy_is_scope_and_risk_gated(self) -> None:
        engagement_id = self._engagement()
        allowed = policy.evaluate(engagement_id, "https://api.example.com/path", "GET", "low-impact")
        self.assertTrue(allowed["allowed"])
        self.assertFalse(allowed["requires_approval"])
        active = policy.evaluate(engagement_id, "https://api.example.com/path", "GET", "state-changing")
        self.assertTrue(active["allowed"])
        self.assertTrue(active["requires_approval"])
        self.assertFalse(policy.evaluate(engagement_id, "https://outside.test", "GET")["allowed"])
        self.assertFalse(policy.evaluate(engagement_id, "https://api.example.com", "POST")["allowed"])

    def test_all_profiles_have_agents_and_compatible_playbooks(self) -> None:
        expected = {profile["id"] for profile in profiles.BUILTIN_PROFILES}
        rows = db.query("SELECT * FROM profiles")
        self.assertEqual({row["id"] for row in rows}, expected)
        for row in rows:
            manifest = db.decode_row(row)["manifest"]
            self.assertTrue(manifest["agents"])
            self.assertTrue(manifest["playbooks"])
            seeded = {item["id"] for item in db.query(
                "SELECT id FROM playbooks WHERE profile_id=?", [row["id"]])}
            self.assertTrue(set(manifest["playbooks"]) & seeded)

    def test_profile_seed_upgrades_preview_manifests_in_place(self) -> None:
        db.execute("UPDATE profiles SET version='0.1.0', manifest='{}' WHERE id='red-team'")
        profiles.seed()
        row = db.decode_row(db.query_one("SELECT * FROM profiles WHERE id='red-team'"))
        self.assertEqual(row["version"], "1.0.0")
        self.assertTrue(row["manifest"]["agents"])
        self.assertEqual(db.query_one(
            "SELECT COUNT(*) c FROM profiles WHERE id='red-team'")["c"], 1)

    def test_preview_playbooks_start_with_scope_gate(self) -> None:
        for profile_id, playbook_id in (("red-team", "red-team-engagement"),
                                        ("blue-team", "blue-team-investigation"),
                                        ("purple-team", "purple-team-validation")):
            engagement_id = self._engagement()
            db.execute("UPDATE engagements SET profile_id=? WHERE id=?", [profile_id, engagement_id])
            run = playbooks.create_run(playbook_id, engagement_id, {"target": "api.example.com"})
            state = playbooks.advance(run["id"])
            self.assertEqual(state["steps"][0]["status"], "done")
            self.assertEqual(state["steps"][1]["status"], "waiting")

    def test_project_templates_are_deny_by_default_and_create_pending_engagement(self) -> None:
        templates = api.list_project_templates(None, {})
        self.assertEqual(len(templates), 13)
        self.assertTrue(all(item["manifest"]["policy"]["default_deny"] for item in templates))
        body = api.ProjectCreate(name="Mobile Review", template_id="android-assessment")
        created = api.create_project(body, {"id": self.user_id})
        self.assertEqual(created["engagement"]["profile_id"], "mobile-security")
        self.assertEqual(created["engagement"]["status"], "authorization-pending")
        self.assertEqual(db.query_one(
            "SELECT COUNT(*) c FROM scope_rules_v2 WHERE engagement_id=?",
            [created["engagement"]["id"]])["c"], 0)

    def test_runtime_summary_separates_control_plane_from_workspace_shell(self) -> None:
        project = api.create_project(api.ProjectCreate(
            name="Web Scope", template_id="web-penetration-test"), {"id": self.user_id})
        engagement_id = project["engagement"]["id"]
        db.execute("UPDATE engagements SET status='authorized' WHERE id=?", [engagement_id])
        runtime = api.runtime_summary(project["id"], {"id": self.user_id})
        self.assertEqual(runtime["separation"]["state"], "Separated")
        self.assertEqual(runtime["project"]["id"], project["id"])
        self.assertEqual(runtime["engagement"]["id"], engagement_id)
        self.assertEqual(runtime["profile"]["id"], "web-application-testing")
        ids = {panel["id"] for panel in runtime["surface"]}
        self.assertIn("control-plane", ids)
        self.assertIn("workspace-shell", ids)
        self.assertIn("plugin-center", ids)

    def test_targets_and_acknowledgment_activate_scopeguard(self) -> None:
        project = api.create_project(api.ProjectCreate(
            name="Web Scope", template_id="web-penetration-test"), {"id": self.user_id})
        engagement_id = project["engagement"]["id"]
        target = api.create_target(project["id"], api.TargetCreate(
            name="Example API", target_type="domain", pattern="*.Example.com",
            status="in-scope"), {"id": self.user_id})
        self.assertEqual(target["normalized"], "*.example.com")
        self.assertFalse(policy.evaluate(
            engagement_id, "https://api.example.com", "GET", "low-impact")["allowed"])
        api.add_scope_rule(engagement_id, api.ScopeRuleCreate(
            effect="include", resource_type="domain", pattern=target["normalized"],
            ports=[443], methods=["GET"], max_requests_min=30), {"id": self.user_id})
        pending = policy.evaluate(engagement_id, "https://api.example.com", "GET", "low-impact")
        self.assertFalse(pending["allowed"])
        self.assertIn("authorization", pending["reason"])

        acknowledgment = api.acknowledge_scope(engagement_id, api.ScopeAcknowledgmentCreate(
            authorization_status="authorized",
            acknowledgment="I have written authorization for this target scope.",
            policy_reference="https://program.example/policy",
            allowed_methods=["GET"], rate_limit_per_minute=25, concurrency_limit=2,
            destructive_actions="blocked", credential_testing="blocked",
            data_handling="Do not store secrets."), {"id": self.user_id})
        self.assertEqual(acknowledgment["authorization_status"], "authorized")
        allowed = policy.evaluate(engagement_id, "https://api.example.com", "GET", "low-impact")
        self.assertTrue(allowed["allowed"])
        self.assertEqual(allowed["rate_limit_per_minute"], 25)
        denied = policy.evaluate(engagement_id, "https://api.example.com", "POST", "low-impact")
        self.assertFalse(denied["allowed"])
        self.assertIn("method", denied["reason"])
        blocked = policy.evaluate(engagement_id, "https://outside.test", "GET", "low-impact")
        self.assertFalse(blocked["allowed"])
        scan = api.start_scan(project["id"], api.ScanCreate(target="https://api.example.com"), {})
        self.assertIsNotNone(scan["execution_id"])

    def test_scan_requires_authorized_scope(self) -> None:
        project = api.create_project(api.ProjectCreate(
            name="Pending API", template_id="api-security-assessment"), {"id": self.user_id})
        with self.assertRaises(api.HTTPException) as raised:
            api.start_scan(project["id"], api.ScanCreate(target="https://api.example.com"), {})
        self.assertEqual(raised.exception.status_code, 409)

    def test_hypotheses_can_be_isolated_by_engagement(self) -> None:
        first_engagement = self._engagement()
        second_engagement = self._engagement()
        research.create_hypothesis(self.project_id, first_engagement, "First engagement",
                                   "Only visible in the first engagement", "low", None, [], [],
                                   self.user_id)
        research.create_hypothesis(self.project_id, second_engagement, "Second engagement",
                                   "Only visible in the second engagement", "low", None, [], [],
                                   self.user_id)
        first = api.list_hypotheses(self.project_id, first_engagement, {})
        second = api.list_hypotheses(self.project_id, second_engagement, {})
        combined = api.list_hypotheses(self.project_id, None, {})
        self.assertEqual([item["title"] for item in first], ["First engagement"])
        self.assertEqual([item["title"] for item in second], ["Second engagement"])
        self.assertEqual({item["title"] for item in combined},
                         {"First engagement", "Second engagement"})

    def test_execution_idempotency(self) -> None:
        first = executions.create(self.project_id, "test", {"value": 1}, idempotency_key="same")
        second = executions.create(self.project_id, "test", {"value": 2}, idempotency_key="same")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(db.query("SELECT * FROM execution_events")), 1)

    def test_api_keys_are_hashed_and_legacy_keys_upgrade_on_use(self) -> None:
        created = auth.create_user("member@test.local", "Member")
        self.assertTrue(created["api_key"].startswith("cbx_"))
        stored = db.query_one("SELECT api_key FROM users WHERE id=?", [created["id"]])
        self.assertTrue(stored["api_key"].startswith("sha256:"))
        self.assertNotEqual(stored["api_key"], created["api_key"])
        self.assertEqual(auth.authenticate_key(created["api_key"])["id"], created["id"])

        legacy_key = f"cbx_{uuid.uuid4()}"
        legacy_id = str(uuid.uuid4())
        db.insert("users", {"id": legacy_id, "email": f"{legacy_id}@test.local",
                            "name": "Legacy", "role": "member", "api_key": legacy_key,
                            "created_at": "now"})
        self.assertEqual(auth.authenticate_key(legacy_key)["id"], legacy_id)
        upgraded = db.query_one("SELECT api_key FROM users WHERE id=?", [legacy_id])
        self.assertTrue(upgraded["api_key"].startswith("sha256:"))
        self.assertNotIn(legacy_key, upgraded["api_key"])

    def test_websocket_rejects_anonymous_and_accepts_authenticated_clients(self) -> None:
        class WebSocketDouble:
            def __init__(self, headers: dict[str, str]):
                self.headers = headers
                self.accepted = False
                self.closed: tuple[int, str] | None = None

            async def accept(self):
                self.accepted = True

            async def close(self, code: int, reason: str):
                self.closed = (code, reason)

            async def receive_text(self):
                raise WebSocketDisconnect(code=1000)

        anonymous = WebSocketDouble({})
        asyncio.run(ws_endpoint(anonymous))
        self.assertFalse(anonymous.accepted)
        self.assertEqual(anonymous.closed, (4401, "authentication required"))

        authenticated = WebSocketDouble({"x-api-key": f"cbx_{self.user_id}"})
        asyncio.run(ws_endpoint(authenticated))
        self.assertTrue(authenticated.accepted)
        self.assertIsNone(authenticated.closed)

    def test_health_includes_database_integrity(self) -> None:
        result = app_health()
        self.assertIsInstance(result, dict)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["database"], "ready")

    def test_artifact_is_content_addressed_and_verified(self) -> None:
        first = artifacts.store(self.project_id, "evidence", b"proof", "text/plain")
        second = artifacts.store(self.project_id, "evidence", b"proof", "text/plain")
        self.assertEqual(first["id"], second["id"])
        record, content = artifacts.read(first["id"])
        self.assertEqual(content, b"proof")
        self.assertEqual(record["sha256"], first["sha256"])

    def test_capability_tokens_gate_provider_artifact_writes(self) -> None:
        issued = api.issue_capability(self.project_id, api.CapabilityCreate(
            subject_type="provider", subject_id="browser-capture",
            permissions=["evidence.write"], ttl_seconds=60), {"id": self.user_id})
        self.assertTrue(issued["token"].startswith("cbcap_"))
        stored = db.query_one("SELECT token_digest FROM capability_tokens WHERE id=?", [issued["id"]])
        self.assertTrue(stored["token_digest"].startswith("sha256:"))
        self.assertNotIn(issued["token"], stored["token_digest"])

        verified = capabilities.verify(issued["token"], "evidence.write", self.project_id)
        self.assertEqual(verified["subject_id"], "browser-capture")
        with self.assertRaises(PermissionError):
            capabilities.verify(issued["token"], "terminal.execute", self.project_id)
        with self.assertRaises(PermissionError):
            capabilities.verify(issued["token"], "evidence.write", str(uuid.uuid4()))

        artifact = api.create_provider_artifact(
            self.project_id,
            api.ArtifactCreate(kind="screenshot", media_type="text/plain",
                               content_base64="cHJvb2Y=", metadata={"source": "test"}),
            x_cyberbox_capability=issued["token"],
        )
        self.assertEqual(artifact["kind"], "screenshot")

        revoked = api.revoke_capability(issued["id"], {"id": self.user_id})
        self.assertEqual(revoked["status"], "revoked")
        with self.assertRaises(api.HTTPException) as raised:
            api.create_provider_artifact(
                self.project_id,
                api.ArtifactCreate(kind="screenshot", media_type="text/plain",
                                   content_base64="cHJvb2Y="),
                x_cyberbox_capability=issued["token"],
            )
        self.assertEqual(raised.exception.status_code, 403)

    def test_internal_service_can_issue_provider_capability_only_when_enabled(self) -> None:
        import cyberbox.config as config

        config._settings.internal_service_token = "cbin_test"
        issued = api.issue_internal_capability(self.project_id, api.CapabilityCreate(
            subject_type="provider", subject_id="plugin-center",
            permissions=["evidence.write"], ttl_seconds=60), None)
        self.assertTrue(issued["token"].startswith("cbcap_"))
        verified = capabilities.verify(issued["token"], "evidence.write", self.project_id)
        self.assertEqual(verified["subject_id"], "plugin-center")
        config._settings.internal_service_token = ""
        with self.assertRaises(api.HTTPException) as raised:
            auth.require_internal_service("wrong")
        self.assertEqual(raised.exception.status_code, 503)
        config._settings.internal_service_token = "cbin_test"
        system = api.issue_internal_system_capability(api.CapabilityCreate(
            subject_type="provider", subject_id="plugin-center",
            permissions=["plugin.registry.sync"], ttl_seconds=60), None)
        self.assertEqual(system["project_id"], capabilities.SYSTEM_PROJECT_ID)
        verified = api.verify_internal_capability(api.CapabilityVerify(
            token=system["token"], permission="plugin.registry.sync",
            project_id=capabilities.SYSTEM_PROJECT_ID), None)
        self.assertTrue(verified["ok"])
        restart = api.issue_internal_system_capability(api.CapabilityCreate(
            subject_type="provider", subject_id="plugin-center",
            permissions=["service.restart"], ttl_seconds=60), None)
        self.assertEqual(restart["project_id"], capabilities.SYSTEM_PROJECT_ID)
        restarted = api.verify_internal_capability(api.CapabilityVerify(
            token=restart["token"], permission="service.restart",
            project_id=capabilities.SYSTEM_PROJECT_ID), None)
        self.assertTrue(restarted["ok"])
        logs = api.issue_internal_system_capability(api.CapabilityCreate(
            subject_type="provider", subject_id="plugin-center",
            permissions=["service.read"], ttl_seconds=60), None)
        self.assertEqual(logs["project_id"], capabilities.SYSTEM_PROJECT_ID)
        readable = api.verify_internal_capability(api.CapabilityVerify(
            token=logs["token"], permission="service.read",
            project_id=capabilities.SYSTEM_PROJECT_ID), None)
        self.assertTrue(readable["ok"])
        with self.assertRaises(api.HTTPException) as denied:
            api.issue_internal_system_capability(api.CapabilityCreate(
                subject_type="provider", subject_id="plugin-center",
                permissions=["terminal.execute"], ttl_seconds=60), None)
        self.assertEqual(denied.exception.status_code, 400)

    def test_knowledge_pack_requires_provenance(self) -> None:
        manifest = {"id": "owasp-wstg", "name": "OWASP WSTG", "version": "1.0.0",
                    "source_url": "https://owasp.org/", "license": "CC BY-SA 4.0",
                    "sha256": "a" * 64, "signature": "sigstore-bundle", "profiles": ["bug-bounty"]}
        self.assertEqual(knowledge.register(manifest)["status"], "registered")
        with self.assertRaises(ValueError):
            knowledge.register({**manifest, "id": "bad", "signature": ""})

    def test_guided_playbook_pauses_for_scan_approval(self) -> None:
        engagement_id = self._engagement("guided")
        run = playbooks.create_run("bounty-research", engagement_id,
                                   {"target": "api.example.com"})
        state = playbooks.advance(run["id"])
        self.assertEqual(state["steps"][0]["status"], "done")
        self.assertEqual(state["steps"][1]["status"], "running")
        execution = db.query_one("SELECT * FROM executions WHERE id=?",
                                 [state["steps"][1]["execution_id"]])
        self.assertEqual(execution["status"], "awaiting_approval")
        self.assertIsNotNone(db.query_one("SELECT id FROM approvals WHERE execution_id=?",
                                         [execution["id"]]))

    def test_research_to_verified_bundle(self) -> None:
        engagement_id = self._engagement()
        evidence = artifacts.store(self.project_id, "http-transaction", b"request\nresponse", "text/plain")
        hypothesis = research.create_hypothesis(
            self.project_id, engagement_id, "Object access may be missing authorization",
            "A second account can read the first account's object", "medium", None,
            [evidence["id"]], [{"pack_id": "owasp-wstg", "section": "authorization"}], "tester")
        experiment = research.create_experiment(
            hypothesis["id"], "Compare object access", "Replay the authorized request with account B",
            "low-impact", "https://api.example.com/objects/1", "GET", "Account B receives object A")
        completed = research.record_experiment(experiment["id"], "supported", "Distinct account received 200",
                                               [evidence["id"]], [])
        self.assertEqual(completed["status"], "done")
        finding = research.promote_finding(experiment["id"], "Cross-account object access", "high",
                                           "Broken Access Control", "Object ownership is not enforced", "GET /objects/1")
        research.review_finding(finding["id"], "verifier", "confirmed", "high",
                                "Evidence independently confirms cross-account access", [evidence["id"]])
        bundle = bundles.create(self.project_id, [finding["id"]])
        self.assertTrue(bundles.verify(bundle["id"])["valid"])
        stored = db.query_one("SELECT verified, status FROM vulnerabilities WHERE id=?", [finding["id"]])
        self.assertEqual((stored["verified"], stored["status"]), (1, "triaged"))

    def test_knowledge_search_preserves_citations(self) -> None:
        manifest = {"id": "owasp-wstg", "name": "OWASP WSTG", "version": "1.0.0",
                    "source_url": "https://owasp.org/", "license": "CC BY-SA 4.0",
                    "sha256": "b" * 64, "signature": "sigstore-bundle",
                    "profiles": ["bug-bounty"], "documents": [{
                        "title": "Authorization Testing", "source_url": "https://owasp.org/authz",
                        "section": "Object access", "content": (
                            "Authorization testing compares access to an object across distinct user accounts. "
                            "Record the request and response as reproducible evidence.")}]}
        knowledge.register(manifest)
        results = knowledge.search("authorization object accounts", "bug-bounty")
        self.assertEqual(results[0]["citation"]["pack_id"], "owasp-wstg")
        self.assertEqual(results[0]["citation"]["source_url"], "https://owasp.org/authz")
        self.assertEqual(len(results[0]["citation"]["content_sha256"]), 64)

    def test_feedback_requires_approval_before_memory(self) -> None:
        engagement_id = self._engagement()
        evidence = artifacts.store(self.project_id, "http-transaction", b"false positive", "text/plain")
        recorded = memory.record_feedback(
            self.project_id, engagement_id, "finding", "finding-1", "false-positive",
            "A CDN response was shared across unrelated hosts", [evidence["id"]], self.user_id)
        self.assertEqual(db.query_one("SELECT COUNT(*) c FROM research_memory")["c"], 0)
        self.assertEqual(db.query_one("SELECT COUNT(*) c FROM evaluation_fixtures")["c"], 1)
        decided = memory.decide_suggestion(
            recorded["suggestion"]["id"], "approved", self.user_id,
            title="Shared CDN response", lesson="Compare origin-specific evidence before reporting",
            technology_tags=["cdn"])
        self.assertIsNotNone(decided["memory"])
        results = memory.search("origin evidence", "bug-bounty", self.project_id)
        self.assertEqual(results[0]["title"], "Shared CDN response")
        self.assertIn("evidence", results[0]["match_reason"])


if __name__ == "__main__":
    unittest.main()
