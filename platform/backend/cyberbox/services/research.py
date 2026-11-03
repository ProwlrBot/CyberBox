"""Hypothesis, experiment, and evidence-backed finding workflow."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from .. import db
from . import events, executions, policy


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_hypothesis(project_id: str, engagement_id: str, title: str, claim: str,
                      confidence: str, asset_id: str | None, artifact_ids: list[str],
                      citations: list[dict], created_by: str) -> dict:
    engagement = db.query_one("SELECT * FROM engagements WHERE id=? AND project_id=?",
                              [engagement_id, project_id])
    if not engagement:
        raise ValueError("engagement does not belong to project")
    for artifact_id in artifact_ids:
        if not db.query_one("SELECT id FROM artifacts WHERE id=? AND project_id=?",
                            [artifact_id, project_id]):
            raise ValueError(f"artifact does not belong to project: {artifact_id}")
    row = {"id": str(uuid.uuid4()), "project_id": project_id,
           "engagement_id": engagement_id, "asset_id": asset_id, "title": title,
           "claim": claim, "status": "proposed", "confidence": confidence,
           "supporting_artifacts": json.dumps(artifact_ids), "contradicting_artifacts": "[]",
           "knowledge_citations": json.dumps(citations, sort_keys=True), "created_by": created_by,
           "created_at": _now(), "updated_at": _now()}
    db.insert("hypotheses", row)
    events.append(project_id, "hypothesis.created", {"hypothesis_id": row["id"]},
                  actor_type="user", actor_id=created_by)
    return db.decode_row(row)


def create_experiment(hypothesis_id: str, name: str, procedure: str, risk_class: str,
                      target_url: str, method: str, expected_signal: str) -> dict:
    hypothesis = db.query_one("SELECT * FROM hypotheses WHERE id=?", [hypothesis_id])
    if not hypothesis:
        raise ValueError("hypothesis not found")
    decision = policy.evaluate(hypothesis["engagement_id"], target_url, method, risk_class)
    if not decision["allowed"]:
        raise PermissionError(decision["reason"])
    execution = executions.create(hypothesis["project_id"], "experiment.http",
                                  {"target_url": target_url, "method": method,
                                   "procedure": procedure, "expected_signal": expected_signal},
                                  hypothesis["engagement_id"], risk_class)
    status = "awaiting_approval" if decision["requires_approval"] else "ready"
    db.execute("UPDATE executions SET status=? WHERE id=?", [status, execution["id"]])
    row = {"id": str(uuid.uuid4()), "hypothesis_id": hypothesis_id,
           "execution_id": execution["id"], "name": name, "procedure": procedure,
           "risk_class": risk_class, "target_url": target_url, "method": method.upper(),
           "expected_signal": expected_signal, "status": status, "result": "{}",
           "created_at": _now(), "finished_at": None}
    db.insert("experiments", row)
    if decision["requires_approval"]:
        approval_id = str(uuid.uuid4())
        db.insert("approvals", {"id": approval_id, "execution_id": execution["id"],
                  "action_class": risk_class, "status": "pending", "reason": decision["reason"],
                  "decided_by": None, "decided_at": None, "expires_at": None, "created_at": _now()})
        events.append(hypothesis["project_id"], "approval.requested",
                      {"approval_id": approval_id, "experiment_id": row["id"]}, execution["id"])
    events.append(hypothesis["project_id"], "experiment.created",
                  {"experiment_id": row["id"], "status": status}, execution["id"])
    return db.decode_row(row)


def record_experiment(experiment_id: str, verdict: str, observations: str,
                      supporting_artifacts: list[str], contradicting_artifacts: list[str]) -> dict:
    experiment = db.query_one("SELECT * FROM experiments WHERE id=?", [experiment_id])
    if not experiment:
        raise ValueError("experiment not found")
    hypothesis = db.query_one("SELECT * FROM hypotheses WHERE id=?", [experiment["hypothesis_id"]])
    all_ids = supporting_artifacts + contradicting_artifacts
    for artifact_id in all_ids:
        if not db.query_one("SELECT id FROM artifacts WHERE id=? AND project_id=?",
                            [artifact_id, hypothesis["project_id"]]):
            raise ValueError(f"artifact does not belong to project: {artifact_id}")
    result = {"verdict": verdict, "observations": observations,
              "supporting_artifacts": supporting_artifacts,
              "contradicting_artifacts": contradicting_artifacts}
    db.execute("UPDATE experiments SET status='done', result=?, finished_at=? WHERE id=?",
               [json.dumps(result, sort_keys=True), _now(), experiment_id])
    db.execute("UPDATE executions SET status='done', output=?, finished_at=? WHERE id=?",
               [json.dumps(result, sort_keys=True), _now(), experiment["execution_id"]])
    hypothesis_status = {"supported": "supported", "contradicted": "rejected",
                         "inconclusive": "inconclusive"}[verdict]
    db.execute("UPDATE hypotheses SET status=?, supporting_artifacts=?, contradicting_artifacts=?, updated_at=? WHERE id=?",
               [hypothesis_status, json.dumps(supporting_artifacts), json.dumps(contradicting_artifacts),
                _now(), hypothesis["id"]])
    events.append(hypothesis["project_id"], "experiment.done",
                  {"experiment_id": experiment_id, "verdict": verdict}, experiment["execution_id"])
    return db.decode_row(db.query_one("SELECT * FROM experiments WHERE id=?", [experiment_id]))


def promote_finding(experiment_id: str, name: str, severity: str, category: str,
                    description: str, poc: str) -> dict:
    experiment = db.query_one("SELECT * FROM experiments WHERE id=? AND status='done'", [experiment_id])
    if not experiment or json.loads(experiment["result"]).get("verdict") != "supported":
        raise ValueError("only a supported completed experiment can become a finding")
    hypothesis = db.query_one("SELECT * FROM hypotheses WHERE id=?", [experiment["hypothesis_id"]])
    finding_id = str(uuid.uuid4())
    row = {"id": finding_id, "project_id": hypothesis["project_id"], "asset_id": hypothesis["asset_id"],
           "template_id": None, "name": name, "severity": severity, "category": category,
           "description": description, "cve": None, "host": experiment["target_url"],
           "matched_at": experiment["target_url"], "status": "open", "verified": 0,
           "poc": poc, "request_chain": "[]", "tags": "[]",
           "dedup_key": f"experiment|{experiment_id}", "sla_due": None,
           "detected_at": _now(), "fixed_at": None}
    db.insert("vulnerabilities", row)
    db.insert("finding_links", {"vulnerability_id": finding_id, "hypothesis_id": hypothesis["id"],
              "experiment_id": experiment_id})
    events.append(hypothesis["project_id"], "finding.promoted",
                  {"finding_id": finding_id, "experiment_id": experiment_id})
    return db.decode_row(row)


def review_finding(finding_id: str, reviewer_type: str, verdict: str,
                   confidence: str, rationale: str, artifact_ids: list[str]) -> dict:
    finding = db.query_one("SELECT * FROM vulnerabilities WHERE id=?", [finding_id])
    if not finding:
        raise ValueError("finding not found")
    row = {"id": str(uuid.uuid4()), "vulnerability_id": finding_id,
           "reviewer_type": reviewer_type, "verdict": verdict, "confidence": confidence,
           "rationale": rationale, "artifact_ids": json.dumps(artifact_ids), "created_at": _now()}
    db.insert("finding_reviews", row)
    verified = verdict == "confirmed" and reviewer_type in ("verifier", "skeptic")
    if verified:
        db.execute("UPDATE vulnerabilities SET verified=1, status='triaged' WHERE id=?", [finding_id])
    events.append(finding["project_id"], "finding.reviewed",
                  {"finding_id": finding_id, "verdict": verdict, "reviewer_type": reviewer_type})
    return db.decode_row(row)
