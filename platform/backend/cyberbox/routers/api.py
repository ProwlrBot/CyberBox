"""CyberBox HTTP API."""
from __future__ import annotations

import base64
import ipaddress
import json
import os
import re
import sqlite3
import urllib.parse
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import db
from ..auth import current_user, require_internal_service
from ..config import get_settings
from ..services import analytics, artifacts, bundles, capabilities, events, executions, knowledge, memory, playbooks, policy, project_templates, research, triage, wordfence
from ..services import gori as gori_svc

router = APIRouter(prefix="/api/v1", tags=["api"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "project"


def _normalize_target(target_type: str, pattern: str) -> str:
    raw = pattern.strip()
    if target_type == "url":
        parsed = urllib.parse.urlsplit(raw)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username:
            raise ValueError("invalid URL target")
        port = f":{parsed.port}" if parsed.port else ""
        path = parsed.path.rstrip("/")
        return f"{parsed.scheme}://{parsed.hostname.lower()}{port}{path}"
    if target_type == "domain":
        host = raw.lower().rstrip(".")
        if not re.fullmatch(r"(\*\.)?[a-z0-9.-]+\.[a-z]{2,63}", host):
            raise ValueError("invalid domain target")
        return host
    if target_type == "cidr":
        return str(ipaddress.ip_network(raw, strict=False))
    if target_type == "ip":
        return str(ipaddress.ip_address(raw))
    return raw.lower()


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=120)
    description: str = ""
    template_id: str | None = Field(default=None, max_length=120)


class ScanCreate(BaseModel):
    target: str = Field(min_length=1, max_length=253)
    tool: str = "full"


class WordfenceRunCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=100, pattern="^[a-z0-9][a-z0-9-]{0,99}$")
    mode: str = Field(default="hunt", pattern="^(preflight|hunt|verify)$")
    idempotency_key: str | None = Field(default=None, max_length=160)


class RaptorScanCreate(BaseModel):
    protocol: str = Field(
        description="Raptor scan protocol",
        pattern="^(mcp|pkg|skill|pypi|go|gitlab|ruby|java|php|gha|github|js|crystal)$",
    )
    target_path: str = Field(min_length=1, max_length=4096,
                              description="Absolute path to the directory or package to scan")
    output_format: str = Field(default="jsonl", pattern="^(jsonl|text|sarif)$")


class EngagementCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    profile_id: str = "bug-bounty"
    autonomy: str = Field(default="balanced", pattern="^(guided|balanced|autonomous)$")
    budget: dict = Field(default_factory=dict)
    policy: dict = Field(default_factory=dict)
    authorization_status: str = Field(
        default="authorization-pending",
        pattern="^(local-laboratory|ctf|authorized|authorization-pending|scope-uncertain|expired|out-of-scope|blocked)$",
    )


class TargetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    target_type: str = Field(default="domain", pattern="^(domain|cidr|ip|url|repository|package|cloud-resource)$")
    pattern: str = Field(min_length=1, max_length=2048)
    status: str = Field(default="candidate", pattern="^(candidate|in-scope|excluded|out-of-scope|archived)$")
    source: str = Field(default="manual", max_length=80)
    metadata: dict = Field(default_factory=dict)


class ScopeRuleCreate(BaseModel):
    effect: str = Field(default="include", pattern="^(include|exclude)$")
    resource_type: str = Field(default="domain", pattern="^(domain|cidr)$")
    pattern: str = Field(min_length=1, max_length=253)
    ports: list[int] = Field(default_factory=list)
    methods: list[str] = Field(default_factory=list)
    max_requests_min: int | None = Field(default=None, ge=1, le=100000)


class ScopeAcknowledgmentCreate(BaseModel):
    authorization_status: str = Field(
        pattern="^(local-laboratory|ctf|authorized|authorization-pending|scope-uncertain|expired|out-of-scope|blocked)$")
    acknowledgment: str = Field(min_length=8, max_length=4000)
    policy_reference: str = Field(default="", max_length=2048)
    allowed_methods: list[str] = Field(default_factory=lambda: ["GET", "HEAD"])
    rate_limit_per_minute: int = Field(default=30, ge=1, le=100000)
    concurrency_limit: int = Field(default=2, ge=1, le=1000)
    destructive_actions: str = Field(default="blocked", pattern="^(blocked|approval-required|allowed)$")
    credential_testing: str = Field(default="blocked", pattern="^(blocked|approval-required|allowed)$")
    data_handling: str = Field(default="", max_length=4000)
    expires_at: str | None = Field(default=None, max_length=80)


class PolicyCheck(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    method: str = Field(default="GET", max_length=16)
    risk_class: str = Field(default="low-impact", pattern=(
        "^(passive|low-impact|state-changing|credential-sensitive|high-volume|destructive|prohibited)$"))


class ArtifactCreate(BaseModel):
    kind: str = Field(min_length=1, max_length=80)
    media_type: str = Field(default="application/octet-stream", max_length=120)
    content_base64: str
    execution_id: str | None = None
    metadata: dict = Field(default_factory=dict)


class CapabilityCreate(BaseModel):
    subject_type: str = Field(default="panel", pattern="^(panel|provider|plugin|mcp|workflow)$")
    subject_id: str = Field(min_length=1, max_length=160)
    permissions: list[str] = Field(min_length=1, max_length=100)
    engagement_id: str | None = None
    ttl_seconds: int = Field(default=900, ge=1, le=3600)
    metadata: dict = Field(default_factory=dict)


class CapabilityVerify(BaseModel):
    token: str = Field(min_length=16, max_length=256)
    permission: str = Field(min_length=1, max_length=120)
    project_id: str | None = None
    engagement_id: str | None = None


class ApprovalDecision(BaseModel):
    status: str = Field(pattern="^(approved|denied)$")
    reason: str = Field(default="", max_length=1000)


class KnowledgePackRegister(BaseModel):
    id: str = Field(min_length=1, max_length=120, pattern="^[a-z0-9][a-z0-9._-]*$")
    name: str = Field(min_length=1, max_length=160)
    version: str = Field(min_length=1, max_length=40)
    source_url: str = Field(min_length=8, max_length=2048)
    license: str = Field(min_length=1, max_length=120)
    sha256: str = Field(min_length=64, max_length=64)
    signature: str = Field(min_length=1, max_length=4096)
    profiles: list[str] = Field(default_factory=list)
    documents: list[dict] = Field(default_factory=list)


class PlaybookRunCreate(BaseModel):
    engagement_id: str
    inputs: dict = Field(default_factory=dict)


class StepComplete(BaseModel):
    output: dict = Field(default_factory=dict)


class HypothesisCreate(BaseModel):
    engagement_id: str
    title: str = Field(min_length=1, max_length=200)
    claim: str = Field(min_length=1, max_length=4000)
    confidence: str = Field(default="low", pattern="^(low|medium|high)$")
    asset_id: str | None = None
    artifact_ids: list[str] = Field(default_factory=list)
    citations: list[dict] = Field(default_factory=list)


class ExperimentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    procedure: str = Field(min_length=1, max_length=8000)
    risk_class: str = Field(default="low-impact", pattern=(
        "^(passive|low-impact|state-changing|credential-sensitive|high-volume|destructive|prohibited)$"))
    target_url: str = Field(min_length=1, max_length=2048)
    method: str = Field(default="GET", max_length=16)
    expected_signal: str = Field(min_length=1, max_length=2000)


class ExperimentResult(BaseModel):
    verdict: str = Field(pattern="^(supported|contradicted|inconclusive)$")
    observations: str = Field(min_length=1, max_length=12000)
    supporting_artifacts: list[str] = Field(default_factory=list)
    contradicting_artifacts: list[str] = Field(default_factory=list)


class FindingPromote(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    severity: str = Field(pattern="^(info|low|medium|high|critical)$")
    category: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=12000)
    poc: str = Field(default="", max_length=20000)


class FindingReviewCreate(BaseModel):
    reviewer_type: str = Field(pattern="^(verifier|skeptic|researcher)$")
    verdict: str = Field(pattern="^(confirmed|rejected|inconclusive|duplicate)$")
    confidence: str = Field(pattern="^(low|medium|high)$")
    rationale: str = Field(min_length=1, max_length=8000)
    artifact_ids: list[str] = Field(default_factory=list)


class BundleCreate(BaseModel):
    finding_ids: list[str] = Field(min_length=1, max_length=100)


class KnowledgeSearch(BaseModel):
    query: str = Field(min_length=2, max_length=1000)
    profile_id: str | None = None
    limit: int = Field(default=8, ge=1, le=50)


class FeedbackCreate(BaseModel):
    engagement_id: str | None = None
    subject_type: str = Field(pattern="^(hypothesis|experiment|finding|playbook-run)$")
    subject_id: str
    disposition: str = Field(pattern="^(confirmed|rejected|duplicate|out-of-scope|informative|flaky|false-positive)$")
    notes: str = Field(min_length=1, max_length=8000)
    artifact_ids: list[str] = Field(default_factory=list)


class MemoryDecision(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    title: str | None = Field(default=None, max_length=200)
    lesson: str | None = Field(default=None, max_length=8000)
    technology_tags: list[str] = Field(default_factory=list)


class BrowserHuntControl(BaseModel):
    command: str = Field(pattern="^(pause|resume|auth-begin|auth-ready|auth-restore|approve|policy-mode|redaction|scope-add|agent-claude|agent-ollama)$")
    role: str | None = Field(default=None, pattern="^(attacker|victim)$")
    value: str | None = Field(default=None, max_length=8000)


def _browser_broker(path: str, payload: dict | None = None) -> dict:
    settings = get_settings()
    token_path = settings.browser_operator_token_file
    try:
        token = open(token_path, encoding="utf-8").read().strip() if token_path else ""
    except OSError as exc:
        raise HTTPException(status_code=503, detail="Browser Hunt is not initialized") from exc
    if not token:
        raise HTTPException(status_code=503, detail="Browser Hunt operator token is unavailable")
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        settings.browser_broker_url.rstrip("/") + path,
        data=body,
        method="POST" if body is not None else "GET",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=50) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try: detail = json.loads(exc.read()).get("error", "Browser bridge rejected the request")
        except (ValueError, json.JSONDecodeError): detail = "Browser bridge rejected the request"
        raise HTTPException(status_code=exc.code, detail=detail) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise HTTPException(status_code=503, detail="Browser Hunt bridge is offline") from exc


@router.get("/browser-hunt/status")
def browser_hunt_status(_user: dict = Depends(current_user)) -> dict:
    return _browser_broker("/v1/operator/status")


@router.post("/browser-hunt/control")
def browser_hunt_control(body: BrowserHuntControl, _user: dict = Depends(current_user)) -> dict:
    return _browser_broker("/v1/operator/control", body.model_dump())


@router.get("/projects")
def list_projects(_user: dict = Depends(current_user)) -> list[dict]:
    return db.query("SELECT * FROM projects ORDER BY created_at DESC")


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreate, user: dict = Depends(current_user)) -> dict:
    slug = body.slug or _slugify(body.name)
    if db.query_one("SELECT id FROM projects WHERE slug=?", [slug]):
        raise HTTPException(status_code=409, detail=f"project slug already exists: {slug}")
    template = project_templates.get(body.template_id) if body.template_id else None
    if body.template_id and not template:
        raise HTTPException(status_code=400, detail="unknown project template")
    project = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "name": body.name,
        "description": body.description,
        "created_at": _now(),
    }
    db.insert("projects", project)
    if template:
        manifest = template["manifest"]
        engagement = {
            "id": str(uuid.uuid4()), "project_id": project["id"],
            "name": f"{body.name} — authorization pending",
            "profile_id": template["profile_id"], "autonomy": "guided",
            "status": "authorization-pending", "scope_version": 1,
            "budget": json.dumps(manifest["scope"], sort_keys=True),
            "policy": json.dumps(manifest["policy"], sort_keys=True),
            "starts_at": None, "ends_at": None, "created_by": user["id"],
            "created_at": _now(),
        }
        db.insert("engagements", engagement)
        events.append(project["id"], "project.template_applied",
                      {"template_id": template["id"], "engagement_id": engagement["id"]},
                      actor_type="user", actor_id=user["id"])
        project["template"] = template
        project["engagement"] = db.decode_row(engagement)
    return project


@router.get("/projects/{project_id}")
def get_project(project_id: str, _user: dict = Depends(current_user)) -> dict:
    project = db.query_one("SELECT * FROM projects WHERE id=?", [project_id])
    if not project:
        raise HTTPException(status_code=404, detail="project not found")
    return project


@router.get("/projects/{project_id}/analytics/score")
def project_score(project_id: str, _user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    return analytics.security_score(project_id)


@router.post("/projects/{project_id}/engagements", status_code=201)
def create_engagement(project_id: str, body: EngagementCreate,
                      user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    if not db.query_one("SELECT id FROM profiles WHERE id=?", [body.profile_id]):
        raise HTTPException(status_code=400, detail="unknown profile")
    row = {
        "id": str(uuid.uuid4()), "project_id": project_id, "name": body.name,
        "profile_id": body.profile_id, "autonomy": body.autonomy,
        "status": body.authorization_status,
        "scope_version": 1, "budget": json.dumps(body.budget, sort_keys=True),
        "policy": json.dumps(body.policy, sort_keys=True), "starts_at": _now(), "ends_at": None,
        "created_by": user["id"], "created_at": _now(),
    }
    db.insert("engagements", row)
    events.append(project_id, "engagement.created", {"engagement_id": row["id"],
                  "profile_id": body.profile_id}, actor_type="user", actor_id=user["id"])
    return db.decode_row(row)


@router.get("/projects/{project_id}/engagements")
def list_engagements(project_id: str, _user: dict = Depends(current_user)) -> list[dict]:
    return [db.decode_row(r) for r in db.query(
        "SELECT * FROM engagements WHERE project_id=? ORDER BY created_at DESC", [project_id])]


@router.post("/projects/{project_id}/targets", status_code=201)
def create_target(project_id: str, body: TargetCreate,
                  user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    try:
        normalized = _normalize_target(body.target_type, body.pattern)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    row = {
        "id": str(uuid.uuid4()), "project_id": project_id, "name": body.name,
        "target_type": body.target_type, "pattern": body.pattern.strip(),
        "normalized": normalized, "status": body.status, "source": body.source,
        "metadata": json.dumps(body.metadata, sort_keys=True), "created_by": user["id"],
        "created_at": _now(), "updated_at": _now(),
    }
    try:
        db.insert("project_targets", row)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="target already exists") from exc
    events.append(project_id, "target.created", {"target_id": row["id"],
                  "target_type": body.target_type, "status": body.status},
                  actor_type="user", actor_id=user["id"])
    return db.decode_row(row)


@router.get("/projects/{project_id}/targets")
def list_targets(project_id: str, status: str | None = None,
                 _user: dict = Depends(current_user)) -> list[dict]:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    rows = db.query(
        "SELECT * FROM project_targets WHERE project_id=? AND status=? ORDER BY updated_at DESC"
        if status else "SELECT * FROM project_targets WHERE project_id=? ORDER BY updated_at DESC",
        [project_id, status] if status else [project_id],
    )
    return [db.decode_row(row) for row in rows]


@router.post("/engagements/{engagement_id}/acknowledgments", status_code=201)
def acknowledge_scope(engagement_id: str, body: ScopeAcknowledgmentCreate,
                      user: dict = Depends(current_user)) -> dict:
    engagement = db.query_one("SELECT * FROM engagements WHERE id=?", [engagement_id])
    if not engagement:
        raise HTTPException(status_code=404, detail="engagement not found")
    methods = sorted({method.upper() for method in body.allowed_methods})
    if not methods:
        raise HTTPException(status_code=400, detail="at least one allowed method is required")
    row = {
        "id": str(uuid.uuid4()), "engagement_id": engagement_id,
        "authorization_status": body.authorization_status,
        "policy_reference": body.policy_reference,
        "acknowledged_by": user["id"], "acknowledgment": body.acknowledgment,
        "allowed_methods": json.dumps(methods),
        "rate_limit_per_minute": body.rate_limit_per_minute,
        "concurrency_limit": body.concurrency_limit,
        "destructive_actions": body.destructive_actions,
        "credential_testing": body.credential_testing,
        "data_handling": body.data_handling,
        "expires_at": body.expires_at, "created_at": _now(),
    }
    db.insert("scope_acknowledgments", row)
    db.execute("UPDATE engagements SET status=?, policy=? WHERE id=?", [
        body.authorization_status,
        json.dumps({
            **db.decode_row(engagement)["policy"],
            "allowed_methods": methods,
            "rate_limit_per_minute": body.rate_limit_per_minute,
            "concurrency_limit": body.concurrency_limit,
            "destructive_actions": body.destructive_actions,
            "credential_testing": body.credential_testing,
            "policy_reference": body.policy_reference,
        }, sort_keys=True),
        engagement_id,
    ])
    events.append(engagement["project_id"], "scope.acknowledged", {
        "engagement_id": engagement_id, "authorization_status": body.authorization_status,
        "rate_limit_per_minute": body.rate_limit_per_minute,
        "concurrency_limit": body.concurrency_limit,
    }, actor_type="user", actor_id=user["id"])
    return db.decode_row(row)


@router.get("/engagements/{engagement_id}/acknowledgments")
def list_acknowledgments(engagement_id: str,
                         _user: dict = Depends(current_user)) -> list[dict]:
    return [db.decode_row(row) for row in db.query(
        "SELECT * FROM scope_acknowledgments WHERE engagement_id=? ORDER BY created_at DESC",
        [engagement_id],
    )]


@router.post("/engagements/{engagement_id}/scope", status_code=201)
def add_scope_rule(engagement_id: str, body: ScopeRuleCreate,
                   user: dict = Depends(current_user)) -> dict:
    engagement = db.query_one("SELECT * FROM engagements WHERE id=?", [engagement_id])
    if not engagement:
        raise HTTPException(status_code=404, detail="engagement not found")
    row = {
        "id": str(uuid.uuid4()), "engagement_id": engagement_id, "effect": body.effect,
        "resource_type": body.resource_type, "pattern": body.pattern.lower(),
        "ports": json.dumps(sorted(set(body.ports))),
        "methods": json.dumps(sorted({m.upper() for m in body.methods})),
        "max_requests_min": body.max_requests_min, "active": 1, "created_at": _now(),
    }
    db.insert("scope_rules_v2", row)
    db.execute("UPDATE engagements SET scope_version=scope_version+1 WHERE id=?", [engagement_id])
    events.append(engagement["project_id"], "scope.rule_added", {"rule_id": row["id"],
                  "engagement_id": engagement_id}, actor_type="user", actor_id=user["id"])
    return db.decode_row(row)


@router.get("/engagements/{engagement_id}/scope")
def list_scope_rules(engagement_id: str, _user: dict = Depends(current_user)) -> list[dict]:
    return [db.decode_row(r) for r in db.query(
        "SELECT * FROM scope_rules_v2 WHERE engagement_id=? ORDER BY effect, pattern", [engagement_id])]


@router.post("/engagements/{engagement_id}/policy/check")
def check_policy(engagement_id: str, body: PolicyCheck,
                 _user: dict = Depends(current_user)) -> dict:
    return policy.evaluate(engagement_id, body.url, body.method, body.risk_class)


class ScopeEvaluateRequest(BaseModel):
    engagement_id: str
    url: str = Field(min_length=1, max_length=2048)
    method: str = Field(default="GET", max_length=16)
    risk_class: str = Field(default="low-impact", pattern=(
        "^(passive|low-impact|state-changing|credential-sensitive|high-volume|destructive|prohibited)$"))


@router.post("/scope/evaluate")
def scope_evaluate(body: ScopeEvaluateRequest, _user: dict = Depends(current_user)) -> dict:
    """Convenience endpoint for cyberbox_runner: engagement_id in body."""
    return policy.evaluate(body.engagement_id, body.url, body.method, body.risk_class)


@router.post("/projects/{project_id}/scans", status_code=202)
def start_scan(project_id: str, body: ScanCreate, _user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    engagement = db.query_one(
        "SELECT id FROM engagements WHERE project_id=? AND status IN "
        "('active','authorized','local-laboratory','ctf') ORDER BY created_at DESC LIMIT 1",
        [project_id],
    )
    if not engagement:
        raise HTTPException(status_code=409, detail="active engagement and scope are required")
    target_url = body.target if "://" in body.target else f"https://{body.target}"
    decision = policy.evaluate(engagement["id"], target_url, "GET", "low-impact")
    if not decision["allowed"]:
        raise HTTPException(status_code=403, detail=f"scan blocked by policy: {decision['reason']}")
    scan = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "task_id": None,
        "target": body.target,
        "tool": body.tool,
        "status": "queued",
        "log": "",
        "stats": "{}",
        "started_at": None,
        "finished_at": None,
        "created_at": _now(),
    }
    db.insert("scans", scan)
    execution = executions.create(project_id, "scan.full", {"scan_id": scan["id"],
                                  "target": body.target, "tool": body.tool},
                                  engagement["id"],
                                  risk_class="low-impact")
    approval_id = None
    if decision["requires_approval"]:
        approval_id = str(uuid.uuid4())
        db.insert("approvals", {"id": approval_id, "execution_id": execution["id"],
                  "action_class": "low-impact", "status": "pending",
                  "reason": decision["reason"], "decided_by": None, "decided_at": None,
                  "expires_at": None, "created_at": _now()})
        db.execute("UPDATE executions SET status='awaiting_approval' WHERE id=?", [execution["id"]])
        events.append(project_id, "approval.requested", {"approval_id": approval_id}, execution["id"])
    else:
        executions.dispatch(execution["id"])
    return {**scan, "execution_id": execution["id"], "approval_id": approval_id}


@router.post("/projects/{project_id}/wordfence/runs", status_code=202)
def start_wordfence_run(project_id: str, body: WordfenceRunCreate,
                        _user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    try:
        wordfence.validate(body.slug, body.mode)
        execution = executions.create(project_id, "wordfence.local",
                                      {"slug": body.slug, "mode": body.mode},
                                      risk_class="passive", idempotency_key=body.idempotency_key)
        executions.dispatch(execution["id"])
        return execution
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/projects/{project_id}/raptor-scan", status_code=202)
def start_raptor_scan(project_id: str, body: RaptorScanCreate,
                      user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    engagement = db.query_one(
        "SELECT id FROM engagements WHERE project_id=? AND status IN "
        "('active','authorized','local-laboratory','ctf') ORDER BY created_at DESC LIMIT 1",
        [project_id],
    )
    if not engagement:
        raise HTTPException(status_code=409, detail="active engagement required for raptor scan")
    try:
        result = scanner.run_raptor_scan(
            project_id, engagement["id"], body.protocol, body.target_path,
            user["id"], body.output_format,
        )
        return result
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/scans/{scan_id}")
def get_scan(scan_id: str, _user: dict = Depends(current_user)) -> dict:
    scan = db.query_one("SELECT * FROM scans WHERE id=?", [scan_id])
    if not scan:
        raise HTTPException(status_code=404, detail="scan not found")
    return scan


@router.get("/executions/{execution_id}")
def get_execution(execution_id: str, _user: dict = Depends(current_user)) -> dict:
    row = db.query_one("SELECT * FROM executions WHERE id=?", [execution_id])
    if not row:
        raise HTTPException(status_code=404, detail="execution not found")
    return db.decode_row(row)


@router.get("/projects/{project_id}/events")
def list_events(project_id: str, after_id: int = 0, limit: int = 200,
                _user: dict = Depends(current_user)) -> list[dict]:
    return events.list_for_project(project_id, after_id, limit)


@router.post("/projects/{project_id}/artifacts", status_code=201)
def create_artifact(project_id: str, body: ArtifactCreate,
                    _user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    try:
        content = base64.b64decode(body.content_base64, validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid base64 content") from exc
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="artifact exceeds 10 MiB API limit")
    return artifacts.store(project_id, body.kind, content, body.media_type,
                           body.execution_id, body.metadata)


@router.post("/provider/projects/{project_id}/artifacts", status_code=201)
def create_provider_artifact(project_id: str, body: ArtifactCreate,
                             x_cyberbox_capability: str | None = Header(default=None)) -> dict:
    try:
        capabilities.verify(x_cyberbox_capability, "evidence.write", project_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    try:
        content = base64.b64decode(body.content_base64, validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid base64 content") from exc
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="artifact exceeds 10 MiB API limit")
    return artifacts.store(project_id, body.kind, content, body.media_type,
                           body.execution_id, body.metadata)


@router.post("/projects/{project_id}/capabilities", status_code=201)
def issue_capability(project_id: str, body: CapabilityCreate,
                     user: dict = Depends(current_user)) -> dict:
    try:
        issued = capabilities.issue(project_id, body.subject_type, body.subject_id,
                                    body.permissions, user["id"], body.engagement_id,
                                    body.ttl_seconds, body.metadata)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    events.append(project_id, "capability.issued", {
        "capability_id": issued["id"], "subject_type": body.subject_type,
        "subject_id": body.subject_id, "permissions": issued["permissions"],
        "expires_at": issued["expires_at"],
    }, actor_type="user", actor_id=user["id"])
    return issued


@router.post("/internal/projects/{project_id}/capabilities", status_code=201)
def issue_internal_capability(project_id: str, body: CapabilityCreate,
                              _internal: None = Depends(require_internal_service)) -> dict:
    try:
        return capabilities.issue_internal(body.subject_type, body.subject_id,
                                           body.permissions, project_id, body.engagement_id,
                                           body.ttl_seconds, body.metadata)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/internal/capabilities", status_code=201)
def issue_internal_system_capability(body: CapabilityCreate,
                                     _internal: None = Depends(require_internal_service)) -> dict:
    try:
        return capabilities.issue_internal(body.subject_type, body.subject_id,
                                           body.permissions, None, body.engagement_id,
                                           body.ttl_seconds, body.metadata)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/projects/{project_id}/capabilities")
def list_capabilities(project_id: str, _user: dict = Depends(current_user)) -> list[dict]:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    rows = db.query(
        "SELECT * FROM capability_tokens WHERE project_id=? ORDER BY issued_at DESC",
        [project_id],
    )
    return [db.decode_row(row) for row in rows]


@router.post("/capabilities/verify")
def verify_capability(body: CapabilityVerify,
                      _user: dict = Depends(current_user)) -> dict:
    try:
        verified = capabilities.verify(
            body.token, body.permission, body.project_id, body.engagement_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return {"ok": True, "capability": verified}


@router.post("/internal/capabilities/verify")
def verify_internal_capability(body: CapabilityVerify,
                               _internal: None = Depends(require_internal_service)) -> dict:
    try:
        verified = capabilities.verify(
            body.token, body.permission, body.project_id, body.engagement_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return {"ok": True, "capability": verified}


@router.post("/capabilities/{capability_id}/revoke")
def revoke_capability(capability_id: str, user: dict = Depends(current_user)) -> dict:
    try:
        revoked = capabilities.revoke(capability_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    events.append(revoked["project_id"], "capability.revoked",
                  {"capability_id": capability_id}, actor_type="user", actor_id=user["id"])
    return revoked


@router.get("/profiles")
def list_profiles(_user: dict = Depends(current_user)) -> list[dict]:
    return [db.decode_row(r) for r in db.query("SELECT * FROM profiles ORDER BY maturity, name")]


@router.get("/runtime")
def runtime_summary(project_id: str | None = None,
                    _user: dict = Depends(current_user)) -> dict:
    project_row = (
        db.query_one("SELECT * FROM projects WHERE id=?", [project_id])
        if project_id else db.query_one("SELECT * FROM projects ORDER BY created_at DESC LIMIT 1")
    )
    project = db.decode_row(project_row or {})
    engagement = {}
    profile = {}
    if project:
        engagement_row = db.query_one(
            "SELECT * FROM engagements WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
            [project["id"]],
        )
        if engagement_row:
            engagement = db.decode_row(engagement_row)
            profile_row = db.query_one("SELECT * FROM profiles WHERE id=?", [engagement["profile_id"]])
            if profile_row:
                profile = db.decode_row(profile_row)
    manifest = profile.get("manifest") if isinstance(profile, dict) else {}
    recommended_panels = []
    if isinstance(manifest, dict):
        recommended_panels = list(manifest.get("recommended_panels") or [])
    surface = [
        {
            "id": "control-plane",
            "name": "Control plane",
            "location": "platform/backend",
            "state": "Ready",
            "note": "API, project, policy, and evidence coordination live here.",
        },
        {
            "id": "workspace-shell",
            "name": "Workspace shell",
            "location": "separate sandbox runtime",
            "state": "Separated",
            "note": "Browser, terminal, Jupyter, code-server, and the Plugin Center run in the workstation container.",
        },
        {
            "id": "plugin-center",
            "name": "Plugin Center",
            "location": "/csbx/",
            "state": "Ready",
            "note": "Plugin catalog and service recovery live in the sandbox dashboard.",
        },
    ]
    if recommended_panels:
        surface.append({
            "id": "profile-panels",
            "name": "Profile panels",
            "location": ", ".join(recommended_panels),
            "state": profile.get("maturity", "preview").title() if profile else "Preview",
            "note": "Recommended panels come from the active profile manifest.",
        })
    return {
        "project": project or None,
        "engagement": engagement or None,
        "profile": profile or None,
        "surface": surface,
        "separation": {
            "state": "Separated",
            "note": "The live workspace shell is intentionally isolated from this control plane.",
        },
    }


@router.get("/project-templates")
def list_project_templates(profile_id: str | None = None,
                           _user: dict = Depends(current_user)) -> list[dict]:
    rows = db.query("SELECT * FROM project_templates WHERE profile_id=? ORDER BY name" if profile_id else
                    "SELECT * FROM project_templates ORDER BY name", [profile_id] if profile_id else [])
    return [db.decode_row(row) for row in rows]


@router.get("/playbooks")
def list_playbooks(profile_id: str | None = None,
                   _user: dict = Depends(current_user)) -> list[dict]:
    rows = db.query("SELECT * FROM playbooks WHERE profile_id=? ORDER BY name" if profile_id else
                    "SELECT * FROM playbooks ORDER BY profile_id, name",
                    [profile_id] if profile_id else [])
    return [db.decode_row(r) for r in rows]


@router.post("/playbooks/{playbook_id}/runs", status_code=201)
def create_playbook_run(playbook_id: str, body: PlaybookRunCreate,
                        user: dict = Depends(current_user)) -> dict:
    try:
        return playbooks.create_run(playbook_id, body.engagement_id, body.inputs, user["id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/playbook-runs/{run_id}")
def get_playbook_run(run_id: str, _user: dict = Depends(current_user)) -> dict:
    try:
        return playbooks.get_run(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/playbook-runs/{run_id}/advance")
def advance_playbook_run(run_id: str, _user: dict = Depends(current_user)) -> dict:
    try:
        return playbooks.advance(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/playbook-runs/{run_id}/steps/{step_id}/complete")
def complete_playbook_step(run_id: str, step_id: str, body: StepComplete,
                           _user: dict = Depends(current_user)) -> dict:
    try:
        playbooks.complete_step(run_id, step_id, body.output)
        return playbooks.advance(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/projects/{project_id}/hypotheses", status_code=201)
def create_hypothesis(project_id: str, body: HypothesisCreate,
                      user: dict = Depends(current_user)) -> dict:
    try:
        return research.create_hypothesis(project_id, body.engagement_id, body.title, body.claim,
                                          body.confidence, body.asset_id, body.artifact_ids,
                                          body.citations, user["id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/projects/{project_id}/hypotheses")
def list_hypotheses(project_id: str, engagement_id: str | None = None,
                    _user: dict = Depends(current_user)) -> list[dict]:
    if engagement_id:
        engagement = db.query_one(
            "SELECT id FROM engagements WHERE id=? AND project_id=?", [engagement_id, project_id])
        if not engagement:
            raise HTTPException(status_code=404, detail="engagement not found in project")
        rows = db.query(
            "SELECT * FROM hypotheses WHERE project_id=? AND engagement_id=? ORDER BY updated_at DESC",
            [project_id, engagement_id])
    else:
        rows = db.query(
            "SELECT * FROM hypotheses WHERE project_id=? ORDER BY updated_at DESC", [project_id])
    return [db.decode_row(r) for r in rows]


@router.post("/hypotheses/{hypothesis_id}/experiments", status_code=201)
def create_experiment(hypothesis_id: str, body: ExperimentCreate,
                      _user: dict = Depends(current_user)) -> dict:
    try:
        return research.create_experiment(hypothesis_id, body.name, body.procedure, body.risk_class,
                                          body.target_url, body.method, body.expected_signal)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=f"experiment blocked by policy: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/experiments/{experiment_id}/result")
def record_experiment_result(experiment_id: str, body: ExperimentResult,
                             _user: dict = Depends(current_user)) -> dict:
    try:
        return research.record_experiment(experiment_id, body.verdict, body.observations,
                                          body.supporting_artifacts, body.contradicting_artifacts)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/experiments/{experiment_id}/finding", status_code=201)
def promote_finding(experiment_id: str, body: FindingPromote,
                    _user: dict = Depends(current_user)) -> dict:
    try:
        return research.promote_finding(experiment_id, body.name, body.severity, body.category,
                                        body.description, body.poc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/findings/{finding_id}/reviews", status_code=201)
def review_finding(finding_id: str, body: FindingReviewCreate,
                   _user: dict = Depends(current_user)) -> dict:
    try:
        return research.review_finding(finding_id, body.reviewer_type, body.verdict,
                                       body.confidence, body.rationale, body.artifact_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/projects/{project_id}/evidence-bundles", status_code=201)
def create_evidence_bundle(project_id: str, body: BundleCreate,
                           user: dict = Depends(current_user)) -> dict:
    try:
        return bundles.create(project_id, body.finding_ids, user["id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/evidence-bundles/{bundle_id}/verify")
def verify_evidence_bundle(bundle_id: str, _user: dict = Depends(current_user)) -> dict:
    try:
        return bundles.verify(bundle_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/knowledge/packs")
def list_knowledge_packs(_user: dict = Depends(current_user)) -> list[dict]:
    return [db.decode_row(r) for r in db.query(
        "SELECT * FROM knowledge_packs ORDER BY name, version")]


@router.post("/knowledge/packs", status_code=201)
def register_knowledge_pack(body: KnowledgePackRegister,
                            _user: dict = Depends(current_user)) -> dict:
    try:
        return knowledge.register(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/knowledge/search")
def search_knowledge(body: KnowledgeSearch, _user: dict = Depends(current_user)) -> dict:
    return {"query": body.query, "results": knowledge.search(body.query, body.profile_id, body.limit)}


@router.post("/projects/{project_id}/feedback", status_code=201)
def record_feedback(project_id: str, body: FeedbackCreate,
                    user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    try:
        return memory.record_feedback(project_id, body.engagement_id, body.subject_type,
                                      body.subject_id, body.disposition, body.notes,
                                      body.artifact_ids, user["id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/memory/suggestions")
def list_memory_suggestions(status: str = "pending",
                            _user: dict = Depends(current_user)) -> list[dict]:
    return [db.decode_row(r) for r in db.query(
        "SELECT * FROM memory_suggestions WHERE status=? ORDER BY created_at", [status])]


@router.post("/memory/suggestions/{suggestion_id}")
def decide_memory_suggestion(suggestion_id: str, body: MemoryDecision,
                             user: dict = Depends(current_user)) -> dict:
    try:
        return memory.decide_suggestion(suggestion_id, body.decision, user["id"],
                                        body.title, body.lesson, body.technology_tags)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/memory/search")
def search_memory(q: str, profile_id: str = "bug-bounty", project_id: str | None = None,
                  limit: int = 10, _user: dict = Depends(current_user)) -> dict:
    return {"query": q, "results": memory.search(q, profile_id, project_id, min(max(limit, 1), 50))}


@router.get("/projects/{project_id}/evaluation-fixtures")
def list_evaluation_fixtures(project_id: str,
                             _user: dict = Depends(current_user)) -> list[dict]:
    return [db.decode_row(r) for r in db.query(
        "SELECT * FROM evaluation_fixtures WHERE project_id=? ORDER BY created_at", [project_id])]


@router.get("/approvals")
def list_approvals(status: str = "pending", _user: dict = Depends(current_user)) -> list[dict]:
    return db.query("SELECT * FROM approvals WHERE status=? ORDER BY created_at", [status])


@router.post("/approvals/{approval_id}")
def decide_approval(approval_id: str, body: ApprovalDecision,
                    user: dict = Depends(current_user)) -> dict:
    approval = db.query_one("SELECT * FROM approvals WHERE id=?", [approval_id])
    if not approval:
        raise HTTPException(status_code=404, detail="approval not found")
    if approval["status"] != "pending":
        raise HTTPException(status_code=409, detail="approval already decided")
    db.execute("UPDATE approvals SET status=?, reason=?, decided_by=?, decided_at=? WHERE id=?",
               [body.status, body.reason, user["id"], _now(), approval_id])
    execution = db.query_one("SELECT project_id FROM executions WHERE id=?", [approval["execution_id"]])
    if execution:
        events.append(execution["project_id"], f"approval.{body.status}",
                      {"approval_id": approval_id}, approval["execution_id"], "user", user["id"])
        if body.status == "approved":
            execution_row = db.query_one("SELECT kind FROM executions WHERE id=?", [approval["execution_id"]])
            next_status = "ready" if execution_row and execution_row["kind"] == "experiment.http" else "queued"
            db.execute("UPDATE executions SET status=? WHERE id=?", [next_status, approval["execution_id"]])
            if next_status == "ready":
                db.execute("UPDATE experiments SET status='ready' WHERE execution_id=?",
                           [approval["execution_id"]])
            else:
                executions.dispatch(approval["execution_id"])
        else:
            executions.transition(approval["execution_id"], "cancelled", error="approval denied")
    return db.query_one("SELECT * FROM approvals WHERE id=?", [approval_id]) or approval


@router.get("/projects/{project_id}/vulnerabilities")
def list_vulnerabilities(project_id: str, _user: dict = Depends(current_user)) -> list[dict]:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    rows = db.query(
        "SELECT * FROM vulnerabilities WHERE project_id=? ORDER BY detected_at DESC",
        [project_id],
    )
    return [db.decode_row(r) for r in rows]


@router.post("/projects/{project_id}/triage")
def run_triage(project_id: str, _user: dict = Depends(current_user)) -> dict:
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    return triage.auto_triage(project_id)


@router.get("/executions")
def list_executions(limit: int = 50, _user: dict = Depends(current_user)) -> list[dict]:
    """Return recent executions across all projects, newest first."""
    limit = min(max(limit, 1), 200)
    rows = db.query(
        "SELECT id, project_id, engagement_id, kind, status, risk_class, "
        "created_at, started_at, finished_at, error "
        "FROM executions ORDER BY created_at DESC LIMIT ?",
        [limit],
    )
    return list(rows)


@router.get("/dashboard", include_in_schema=False)
def hunt_dashboard() -> FileResponse:
    path = os.path.join(os.path.dirname(__file__), "..", "static", "hunt_dashboard.html")
    return FileResponse(os.path.abspath(path))


@router.get("/gori/status")
def gori_status(_user: dict = Depends(current_user)) -> dict:
    """Return whether Caido is reachable and which project is active."""
    s = get_settings()
    info = gori_svc.get_project_info(s)
    return {
        "reachable": bool(info),
        "gori_url": s.gori_url,
        "pat_configured": bool(s.gori_pat),
        "caido_project": info,
    }


@router.post("/projects/{project_id}/gori/import")
def gori_import(project_id: str, _user: dict = Depends(current_user)) -> dict:
    """Pull Caido findings and store them as hypotheses on this project."""
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    s = get_settings()
    issues = gori_svc.get_issues(s)
    imported = 0
    for issue in issues:
        hyp_id = "hyp_" + str(uuid.uuid4()).replace("-", "")[:16]
        title = issue.get("title") or "Caido finding"
        desc = issue.get("description") or ""
        severity = issue.get("severity", "unknown").lower()
        evidence = json.dumps({
            "source": "caido",
            "caido_id": issue.get("id"),
            "request_url": issue.get("request_url"),
            "method": issue.get("method"),
        })
        try:
            db.execute(
                "INSERT OR IGNORE INTO hypotheses "
                "(id, project_id, title, description, severity, status, evidence, created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                [hyp_id, project_id, title, desc, severity, "open", evidence, _now()],
            )
            imported += 1
        except Exception:
            pass
    return {"imported": imported, "total_caido_issues": len(issues)}


@router.get("/projects/{project_id}/gori/flows")
def gori_flows(
    project_id: str,
    host: str | None = None,
    limit: int = 100,
    _user: dict = Depends(current_user),
) -> list[dict]:
    """Return recent HTTP flows from Caido for a given host."""
    if not db.query_one("SELECT id FROM projects WHERE id=?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")
    s = get_settings()
    limit = min(max(limit, 1), 500)
    return gori_svc.get_recent_flows(s, limit=limit, host_filter=host)
