"""Declarative, resumable research playbooks."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from .. import db
from . import events, executions, policy


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


BUG_BOUNTY_PLAYBOOK = {
    "id": "bounty-research", "version": "1.0.0", "name": "Bug Bounty Research",
    "profile_id": "bug-bounty", "maturity": "stable",
    "inputs": {"target": {"type": "string", "required": True}},
    "steps": [
        {"id": "scope-review", "name": "Validate engagement scope", "kind": "scope.check",
         "risk_class": "passive"},
        {"id": "surface-map", "name": "Map the authorized surface", "kind": "scan.full",
         "risk_class": "low-impact", "budget": {"duration_minutes": 30}},
        {"id": "hypothesis-review", "name": "Review and test hypotheses", "kind": "manual",
         "risk_class": "state-changing"},
        {"id": "finding-review", "name": "Verify and challenge findings", "kind": "manual",
         "risk_class": "passive"},
        {"id": "evidence-export", "name": "Export evidence bundle", "kind": "manual",
         "risk_class": "passive"},
    ],
}


BUILTIN_PLAYBOOKS = [
    BUG_BOUNTY_PLAYBOOK,
    {
        "id": "red-team-engagement", "version": "0.2.0",
        "name": "Red Team Engagement", "profile_id": "red-team", "maturity": "preview",
        "inputs": {"target": {"type": "string", "required": True}},
        "steps": [
            {"id": "authorization", "name": "Confirm authorization, scope, and stop conditions",
             "kind": "scope.check", "risk_class": "passive"},
            {"id": "objectives", "name": "Review objectives and select ATT&CK-aligned scenarios",
             "kind": "manual", "risk_class": "passive"},
            {"id": "surface-map", "name": "Map the authorized attack surface",
             "kind": "scan.full", "risk_class": "low-impact", "budget": {"duration_minutes": 30}},
            {"id": "emulation", "name": "Conduct approved scenario with activity logging",
             "kind": "manual", "risk_class": "state-changing"},
            {"id": "impact-review", "name": "Validate impact and preserve evidence",
             "kind": "manual", "risk_class": "passive"},
            {"id": "cleanup", "name": "Remove test artifacts and attest cleanup",
             "kind": "manual", "risk_class": "state-changing"},
            {"id": "report", "name": "Report attack paths, control gaps, and remediation",
             "kind": "manual", "risk_class": "passive"},
        ],
    },
    {
        "id": "blue-team-investigation", "version": "0.2.0",
        "name": "Blue Team Investigation", "profile_id": "blue-team", "maturity": "preview",
        "inputs": {"target": {"type": "string", "required": True}},
        "steps": [
            {"id": "intake", "name": "Confirm incident context and evidence sources",
             "kind": "scope.check", "risk_class": "passive"},
            {"id": "preserve", "name": "Preserve evidence and establish chain of custody",
             "kind": "manual", "risk_class": "passive"},
            {"id": "triage", "name": "Triage indicators, affected identities, and assets",
             "kind": "manual", "risk_class": "passive"},
            {"id": "timeline", "name": "Build and challenge the incident timeline",
             "kind": "manual", "risk_class": "passive"},
            {"id": "containment", "name": "Review and approve containment actions",
             "kind": "manual", "risk_class": "state-changing"},
            {"id": "recovery", "name": "Validate eradication, recovery, and monitoring",
             "kind": "manual", "risk_class": "passive"},
            {"id": "lessons", "name": "Capture detection gaps and lessons learned",
             "kind": "manual", "risk_class": "passive"},
        ],
    },
    {
        "id": "purple-team-validation", "version": "0.2.0",
        "name": "Purple Team Technique Validation", "profile_id": "purple-team",
        "maturity": "preview", "inputs": {"target": {"type": "string", "required": True}},
        "steps": [
            {"id": "roe", "name": "Confirm joint scope, safety controls, and stop conditions",
             "kind": "scope.check", "risk_class": "passive"},
            {"id": "baseline", "name": "Record baseline telemetry and control coverage",
             "kind": "manual", "risk_class": "passive"},
            {"id": "scenario", "name": "Select an ATT&CK technique and expected signals",
             "kind": "manual", "risk_class": "passive"},
            {"id": "emulate", "name": "Run the approved bounded emulation",
             "kind": "manual", "risk_class": "state-changing"},
            {"id": "measure", "name": "Compare observed telemetry with expected signals",
             "kind": "manual", "risk_class": "passive"},
            {"id": "improve", "name": "Tune detections and preventive controls",
             "kind": "manual", "risk_class": "state-changing"},
            {"id": "retest", "name": "Retest and record before/after results",
             "kind": "manual", "risk_class": "state-changing"},
            {"id": "cleanup", "name": "Confirm cleanup and publish coverage outcome",
             "kind": "manual", "risk_class": "passive"},
        ],
    },
]

# Every workspace profile is usable from first launch. Domain-specific automation
# remains Preview; these conservative starters only establish context, scope and
# evidence before handing control to the operator.
_STARTER_PLAYBOOKS = {
    "web-application-testing": ("web-application-assessment", "Web Application Assessment"),
    "api-security": ("api-security-assessment", "API Security Assessment"),
    "mobile-security": ("mobile-application-assessment", "Mobile Application Assessment"),
    "cloud-security": ("cloud-configuration-audit", "Cloud Configuration Audit"),
    "container-kubernetes-security": ("container-kubernetes-assessment", "Container and Kubernetes Assessment"),
    "malware-analysis": ("malware-static-triage", "Contained Malware Static Triage"),
    "digital-forensics": ("digital-forensics-intake", "Digital Forensics Intake"),
    "osint": ("osint-case", "OSINT Case"),
    "soc-incident-response": ("soc-incident-investigation", "SOC Incident Investigation"),
    "ctf": ("ctf-challenge", "CTF Challenge"),
    "security-education": ("security-learning-lab", "Security Learning Lab"),
    "custom": ("custom-workspace", "Custom Workspace"),
}

for _profile_id, (_playbook_id, _name) in _STARTER_PLAYBOOKS.items():
    BUILTIN_PLAYBOOKS.append({
        "id": _playbook_id, "version": "1.0.0", "name": _name,
        "profile_id": _profile_id, "maturity": "preview",
        "inputs": {"target": {"type": "string", "required": True}},
        "steps": [
            {"id": "authorization", "name": "Confirm project authorization and operating policy",
             "kind": "scope.check", "risk_class": "passive"},
            {"id": "intake", "name": "Record targets, inputs, exclusions, and evidence requirements",
             "kind": "manual", "risk_class": "passive"},
            {"id": "provider-review", "name": "Review available providers and capability states",
             "kind": "manual", "risk_class": "passive"},
            {"id": "investigate", "name": "Conduct the approved, bounded investigation",
             "kind": "manual", "risk_class": "state-changing"},
            {"id": "evidence-review", "name": "Hash evidence and review conclusions",
             "kind": "manual", "risk_class": "passive"},
            {"id": "report", "name": "Export reproducibility data and report",
             "kind": "manual", "risk_class": "passive"},
        ],
    })


def seed() -> None:
    for playbook in BUILTIN_PLAYBOOKS:
        row = {"id": playbook["id"], "version": playbook["version"],
               "name": playbook["name"], "profile_id": playbook["profile_id"],
               "maturity": playbook["maturity"],
               "manifest": json.dumps(playbook, sort_keys=True), "builtin": 1,
               "created_at": _now()}
        db.upsert("playbooks", row, ["id", "version"],
                  ["name", "profile_id", "maturity", "manifest", "builtin"])


def create_run(playbook_id: str, engagement_id: str, inputs: dict,
               user_id: str | None = None) -> dict:
    playbook = db.query_one("SELECT * FROM playbooks WHERE id=? ORDER BY version DESC LIMIT 1",
                            [playbook_id])
    engagement = db.query_one("SELECT * FROM engagements WHERE id=?", [engagement_id])
    if not playbook or not engagement:
        raise ValueError("playbook or engagement not found")
    manifest = json.loads(playbook["manifest"])
    if engagement["profile_id"] != playbook["profile_id"]:
        raise ValueError("playbook is not compatible with engagement profile")
    for name, spec in manifest.get("inputs", {}).items():
        if spec.get("required") and not inputs.get(name):
            raise ValueError(f"missing required playbook input: {name}")
    run = {"id": str(uuid.uuid4()), "playbook_id": playbook["id"],
           "playbook_version": playbook["version"], "engagement_id": engagement_id,
           "project_id": engagement["project_id"], "status": "queued",
           "inputs": json.dumps(inputs, sort_keys=True), "context": "{}", "current_step": 0,
           "created_by": user_id, "started_at": None, "finished_at": None, "created_at": _now()}
    db.insert("playbook_runs", run)
    for index, step in enumerate(manifest["steps"]):
        db.insert("playbook_steps", {"id": str(uuid.uuid4()), "run_id": run["id"],
                  "step_index": index, "step_id": step["id"], "execution_id": None,
                  "status": "pending", "input": "{}", "output": "{}", "error": None,
                  "started_at": None, "finished_at": None})
    events.append(engagement["project_id"], "playbook.queued",
                  {"run_id": run["id"], "playbook_id": playbook_id})
    return db.decode_row(run)


def _definition(run: dict, index: int) -> dict:
    playbook = db.query_one("SELECT manifest FROM playbooks WHERE id=? AND version=?",
                            [run["playbook_id"], run["playbook_version"]])
    return json.loads(playbook["manifest"])["steps"][index]


def advance(run_id: str) -> dict:
    run = db.query_one("SELECT * FROM playbook_runs WHERE id=?", [run_id])
    if not run:
        raise ValueError("playbook run not found")
    if run["status"] in ("done", "failed", "cancelled"):
        return db.decode_row(run)
    if run["status"] == "queued":
        db.execute("UPDATE playbook_runs SET status='running', started_at=? WHERE id=?", [_now(), run_id])
        run["status"] = "running"
    index = run["current_step"]
    steps = db.query("SELECT * FROM playbook_steps WHERE run_id=? ORDER BY step_index", [run_id])
    if index >= len(steps):
        db.execute("UPDATE playbook_runs SET status='done', finished_at=? WHERE id=?", [_now(), run_id])
        events.append(run["project_id"], "playbook.done", {"run_id": run_id})
        return db.decode_row(db.query_one("SELECT * FROM playbook_runs WHERE id=?", [run_id]))
    step, definition = steps[index], _definition(run, index)

    if step["status"] == "running" and step["execution_id"]:
        execution = db.query_one("SELECT * FROM executions WHERE id=?", [step["execution_id"]])
        if execution and execution["status"] == "done":
            complete_step(run_id, step["id"], json.loads(execution["output"]))
            return advance(run_id)
        if execution and execution["status"] in ("failed", "cancelled"):
            db.execute("UPDATE playbook_steps SET status='failed', error=?, finished_at=? WHERE id=?",
                       [execution["error"], _now(), step["id"]])
            db.execute("UPDATE playbook_runs SET status='failed', finished_at=? WHERE id=?", [_now(), run_id])
        return get_run(run_id)

    if definition["kind"] == "manual":
        db.execute("UPDATE playbook_steps SET status='waiting', started_at=COALESCE(started_at, ?) WHERE id=?",
                   [_now(), step["id"]])
        events.append(run["project_id"], "playbook.step_waiting",
                      {"run_id": run_id, "step_id": definition["id"]})
        return get_run(run_id)

    inputs = json.loads(run["inputs"])
    if definition["kind"] == "scope.check":
        decision = policy.evaluate(run["engagement_id"],
                                   inputs["target"] if "://" in inputs["target"] else f"https://{inputs['target']}",
                                   "GET", "passive")
        if not decision["allowed"]:
            raise ValueError(f"playbook target blocked by policy: {decision['reason']}")
        complete_step(run_id, step["id"], decision)
        return advance(run_id)

    if definition["kind"] == "scan.full":
        target_url = inputs["target"] if "://" in inputs["target"] else f"https://{inputs['target']}"
        decision = policy.evaluate(run["engagement_id"], target_url, "GET", definition["risk_class"])
        if not decision["allowed"]:
            raise ValueError(f"playbook step blocked by policy: {decision['reason']}")
        scan_id = str(uuid.uuid4())
        db.insert("scans", {"id": scan_id, "project_id": run["project_id"], "task_id": None,
                  "target": inputs["target"], "tool": "full", "status": "queued", "log": "",
                  "stats": "{}", "started_at": None, "finished_at": None, "created_at": _now()})
        execution = executions.create(run["project_id"], "scan.full",
                                      {"scan_id": scan_id, "target": inputs["target"], "tool": "full"},
                                      run["engagement_id"], definition["risk_class"],
                                      definition.get("budget", {}), f"playbook:{run_id}:{definition['id']}")
        db.execute("UPDATE playbook_steps SET status='running', execution_id=?, started_at=? WHERE id=?",
                   [execution["id"], _now(), step["id"]])
        if decision["requires_approval"]:
            approval_id = str(uuid.uuid4())
            db.insert("approvals", {"id": approval_id, "execution_id": execution["id"],
                      "action_class": definition["risk_class"], "status": "pending",
                      "reason": decision["reason"], "decided_by": None, "decided_at": None,
                      "expires_at": None, "created_at": _now()})
            db.execute("UPDATE executions SET status='awaiting_approval' WHERE id=?", [execution["id"]])
            events.append(run["project_id"], "approval.requested",
                          {"approval_id": approval_id, "run_id": run_id,
                           "step_id": definition["id"]}, execution["id"])
        else:
            executions.dispatch(execution["id"])
        return get_run(run_id)
    raise ValueError(f"unsupported playbook step kind: {definition['kind']}")


def complete_step(run_id: str, step_row_id: str, output: dict) -> dict:
    step = db.query_one("SELECT * FROM playbook_steps WHERE id=? AND run_id=?", [step_row_id, run_id])
    if not step or step["status"] not in ("pending", "waiting", "running"):
        raise ValueError("playbook step cannot be completed")
    db.execute("UPDATE playbook_steps SET status='done', output=?, finished_at=? WHERE id=?",
               [json.dumps(output, sort_keys=True), _now(), step_row_id])
    db.execute("UPDATE playbook_runs SET current_step=current_step+1 WHERE id=?", [run_id])
    run = db.query_one("SELECT * FROM playbook_runs WHERE id=?", [run_id])
    events.append(run["project_id"], "playbook.step_done",
                  {"run_id": run_id, "step_id": step["step_id"]})
    return get_run(run_id)


def get_run(run_id: str) -> dict:
    run = db.query_one("SELECT * FROM playbook_runs WHERE id=?", [run_id])
    if not run:
        raise ValueError("playbook run not found")
    decoded = db.decode_row(run)
    decoded["steps"] = [db.decode_row(s) for s in db.query(
        "SELECT * FROM playbook_steps WHERE run_id=? ORDER BY step_index", [run_id])]
    return decoded
