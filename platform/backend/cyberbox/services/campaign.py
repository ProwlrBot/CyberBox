"""Autonomous campaign orchestrator.

A campaign runs phases in sequence:
  recon → fuzz → validate → report

Each phase is orchestrated by a supervisor LLM that plans the attack surface,
generates test cases, and validates candidate findings. Actual tool execution
(nuclei, ffuf, nmap, subfinder) is queued as execution records for the sandbox
runner — this module does not shell out directly.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from .. import db
from ..hub import hub
from . import model as model_svc

HUNT_PHASES: dict[str, list[str]] = {
    "full_auto":     ["recon", "fuzz", "validate", "report"],
    "recon_only":    ["recon", "report"],
    "api_fuzz":      ["fuzz", "validate", "report"],
    "source_review": ["source_scan", "report"],
}

VALID_SEVERITIES = {"critical", "high", "medium", "low", "info"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create_campaign(
    project_id: str,
    name: str,
    target_url: str,
    hunt_type: str,
    provider_id: str | None,
    max_runtime: int,
) -> dict:
    row = {
        "id":         str(uuid.uuid4()),
        "project_id": project_id,
        "name":       name[:200],
        "target_url": target_url[:1024],
        "hunt_type":  hunt_type,
        "provider_id": provider_id,
        "status":     "queued",
        "phase":      None,
        "progress":   0,
        "max_runtime": max_runtime,
        "findings_count": 0,
        "agent_ids":  "[]",
        "started_at": None,
        "finished_at": None,
        "error":      None,
        "report_md":  None,
        "created_at": _now(),
    }
    db.insert("campaigns", row)
    hub.broadcast("campaign.created", {"id": row["id"], "name": name, "project_id": project_id})
    return db.decode_row(row)


def get_campaign(campaign_id: str) -> dict:
    row = db.query_one("SELECT * FROM campaigns WHERE id=?", [campaign_id])
    if not row:
        raise ValueError(f"campaign not found: {campaign_id}")
    return db.decode_row(row)


def list_campaigns(project_id: str) -> list[dict]:
    rows = db.query(
        "SELECT * FROM campaigns WHERE project_id=? ORDER BY created_at DESC",
        [project_id],
    )
    return [db.decode_row(r) for r in rows]


def cancel_campaign(campaign_id: str) -> dict:
    c = get_campaign(campaign_id)
    if c["status"] in ("done", "failed", "cancelled"):
        return c
    db.execute(
        "UPDATE campaigns SET status='cancelled', finished_at=? WHERE id=?",
        [_now(), campaign_id],
    )
    _append_event(campaign_id, "campaign.cancelled", "Campaign cancelled by user")
    hub.broadcast("campaign.cancelled", {"id": campaign_id})
    return get_campaign(campaign_id)


def _update_campaign(campaign_id: str, **kwargs: object) -> None:
    if not kwargs:
        return
    sets = ", ".join(f"{k}=?" for k in kwargs)
    db.execute(
        f"UPDATE campaigns SET {sets} WHERE id=?",  # noqa: S608 — controlled keys
        [*kwargs.values(), campaign_id],
    )


def _append_event(
    campaign_id: str,
    event_type: str,
    summary: str,
    phase: str | None = None,
    detail: dict | None = None,
) -> None:
    row = {
        "campaign_id": campaign_id,
        "phase":       phase,
        "event_type":  event_type,
        "summary":     summary[:500],
        "detail":      json.dumps(detail) if detail else None,
        "occurred_at": _now(),
    }
    db.insert("campaign_events", row)
    hub.broadcast("campaign.event", {
        "campaign_id": campaign_id,
        "event_type": event_type,
        "summary": summary,
        "phase": phase,
    })


# ── Tool job queuing (sandbox runner picks these up) ──────────────────────────

def queue_tool_job(campaign_id: str, project_id: str, tool_name: str, args: dict) -> str:
    """Queue an execution record for sandbox tool dispatch. Returns execution_id."""
    exec_id = str(uuid.uuid4())
    row = {
        "id":           exec_id,
        "project_id":   project_id,
        "engagement_id": None,
        "kind":         f"tool:{tool_name}",
        "status":       "queued",
        "risk_class":   "active",
        "input":        json.dumps({"tool": tool_name, "args": args, "campaign_id": campaign_id}),
        "output":       "{}",
        "budget":       "{}",
        "idempotency_key": f"campaign:{campaign_id}:{tool_name}:{uuid.uuid4().hex[:8]}",
        "lease_owner":  None,
        "lease_expires_at": None,
        "attempt":      0,
        "error":        None,
        "started_at":   None,
        "finished_at":  None,
        "created_at":   _now(),
    }
    db.insert("executions", row)
    _append_event(campaign_id, "tool.queued", f"Queued {tool_name}", detail={"args": args, "execution_id": exec_id})
    return exec_id


# ── LLM supervisor prompts ────────────────────────────────────────────────────

def _recon_prompt(target_url: str) -> str:
    return f"""You are an autonomous security researcher beginning reconnaissance on {target_url}.

Your task: plan a recon sweep and identify the attack surface.

Based on the target URL, identify:
1. Likely technology stack (from URL patterns, common paths)
2. Top 10 endpoint categories to investigate
3. Authentication surface (login, OAuth, API keys)
4. 3 highest-priority attack hypotheses for this target type

Respond ONLY as valid JSON (no markdown, no explanation outside the JSON):
{{
  "tech_stack": ["..."],
  "attack_surface": [{{"path": "...", "risk": "high|medium|low", "reason": "..."}}],
  "hypotheses": [{{
    "title": "...",
    "severity": "critical|high|medium|low",
    "type": "BOLA|SSRF|SQLi|XSS|RCE|AuthBypass|InfoDisc",
    "rationale": "...",
    "test_steps": ["..."]
  }}]
}}"""


def _fuzz_prompt(target_url: str, attack_surface: list, hypotheses: list) -> str:
    return f"""You are analyzing a web target at {target_url} with this known attack surface:
{json.dumps(attack_surface, indent=2)}

Prior hypotheses from recon:
{json.dumps(hypotheses, indent=2)}

Your task: generate specific test cases for the top 3 hypotheses.
For each test case provide: the exact HTTP request (method, path, headers, body),
expected vulnerability behavior, and how to confirm exploitation.

Respond ONLY as valid JSON:
{{
  "test_cases": [{{
    "hypothesis_title": "...",
    "request": {{"method": "GET", "path": "...", "headers": {{}}, "body": null}},
    "expected_indicator": "...",
    "confirm_steps": ["..."]
  }}]
}}"""


def _validate_prompt(target_url: str, findings: list) -> str:
    return f"""You are a security validator reviewing these candidate findings from {target_url}:
{json.dumps(findings, indent=2)}

For each finding, assess:
1. Is the evidence sufficient to confirm exploitation? (not just a 500 or redirect)
2. Is the impact real and demonstrable?
3. What is the CVSS-equivalent severity?
4. Is this in scope for a standard bug bounty program?

Respond ONLY as valid JSON:
{{
  "verdicts": [{{
    "title": "...",
    "verdict": "confirmed|likely|insufficient_evidence|false_positive",
    "severity": "critical|high|medium|low|info",
    "confidence": 0,
    "rationale": "...",
    "report_worthy": true
  }}]
}}"""


def _source_scan_prompt(target_url: str) -> str:
    return f"""You are performing a security source review for the application at {target_url}.

Analyze what can be inferred about the codebase from the URL structure, paths, and any
publicly observable behaviors. Identify:
1. Framework/language signals from URL patterns
2. Common vulnerable code patterns for this stack
3. Likely security misconfigurations

Respond ONLY as valid JSON:
{{
  "framework_signals": ["..."],
  "risk_patterns": [{{"pattern": "...", "severity": "high|medium|low", "cwe": "..."}}],
  "hypotheses": [{{
    "title": "...",
    "severity": "critical|high|medium|low",
    "rationale": "..."
  }}]
}}"""


# ── JSON parser (tolerant) ────────────────────────────────────────────────────

def _parse_json(text: str) -> dict:
    """Extract and parse the first JSON object from an LLM response."""
    text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {}


# ── Report generator ──────────────────────────────────────────────────────────

def _generate_report(campaign: dict, findings: list[dict]) -> str:
    target = campaign["target_url"]
    name = campaign["name"]
    now = _now()[:10]
    report_worthy = [f for f in findings if f.get("report_worthy") or f.get("verdict") in ("confirmed", "likely")]

    lines = [
        f"# Security Assessment Report: {name}",
        f"",
        f"**Target:** `{target}`  ",
        f"**Date:** {now}  ",
        f"**Hunt type:** {campaign['hunt_type']}  ",
        f"**Findings:** {len(report_worthy)} reportable ({len(findings)} total candidates)  ",
        f"",
        f"## Executive Summary",
        f"",
    ]

    if not report_worthy:
        lines.append("No confirmed or likely findings were identified during this assessment.")
    else:
        sevs = {}
        for f in report_worthy:
            s = f.get("severity", "info")
            sevs[s] = sevs.get(s, 0) + 1
        summary_parts = [f"{v} {k}" for k, v in sevs.items()]
        lines.append(
            f"This automated assessment of `{target}` identified {len(report_worthy)} reportable "
            f"findings: {', '.join(summary_parts)}."
        )

    lines += [
        f"",
        f"## Findings Summary",
        f"",
        f"| # | Title | Severity | Confidence | Verdict |",
        f"|---|-------|----------|------------|---------|",
    ]
    for i, f in enumerate(report_worthy, 1):
        lines.append(
            f"| {i} | {f.get('title', 'Untitled')} "
            f"| {f.get('severity', 'info').upper()} "
            f"| {f.get('confidence', 0)}% "
            f"| {f.get('verdict', 'candidate')} |"
        )

    for i, f in enumerate(report_worthy, 1):
        lines += [
            f"",
            f"---",
            f"",
            f"## Finding {i}: {f.get('title', 'Untitled')}",
            f"",
            f"**Severity:** {f.get('severity', 'info').upper()}  ",
            f"**Verdict:** {f.get('verdict', 'candidate')}  ",
            f"**Confidence:** {f.get('confidence', 0)}%  ",
            f"",
            f"### Description",
            f"",
            f"{f.get('rationale') or f.get('description', '_No description provided._')}",
            f"",
            f"### Reproduction Steps",
            f"",
        ]
        for step in f.get("test_steps") or f.get("confirm_steps") or ["_See campaign events for test case details._"]:
            lines.append(f"1. {step}")
        lines += [
            f"",
            f"### Impact",
            f"",
            f"_{f.get('type', 'Security vulnerability')} class. Confirm exploitation before reporting._",
            f"",
            f"### Remediation",
            f"",
            f"_Apply principle of least privilege. Validate and sanitize all inputs. "
            f"Review authentication and authorization logic for this endpoint._",
        ]

    lines += [
        f"",
        f"---",
        f"",
        f"*Generated by CyberBox autonomous hunt engine. All findings are candidates — "
        f"manual verification is required before submission.*",
    ]
    return "\n".join(lines)


# ── Phase runners ─────────────────────────────────────────────────────────────

def _resolve_provider(provider_id: str | None) -> str | None:
    if provider_id:
        return provider_id
    rows = db.query("SELECT id FROM model_providers WHERE enabled=1 ORDER BY local DESC, name LIMIT 1")
    return rows[0]["id"] if rows else None


def _llm_call(provider_id: str | None, messages: list[dict], system: str) -> str:
    if not provider_id:
        return "{}"
    try:
        return model_svc.complete(
            messages=messages,
            provider_id=provider_id,
            system=system,
            max_tokens=4096,
            allow_external=True,
        )
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


async def _phase_recon(campaign_id: str, campaign: dict, ctx: dict) -> dict:
    _update_campaign(campaign_id, phase="recon", progress=10)
    _append_event(campaign_id, "phase.change", "Starting recon phase", phase="recon")

    # Queue actual tool jobs
    queue_tool_job(campaign_id, campaign["project_id"], "subfinder",
                   {"target": campaign["target_url"]})
    queue_tool_job(campaign_id, campaign["project_id"], "httpx",
                   {"target": campaign["target_url"]})
    _append_event(campaign_id, "tool.queued", "Queued subfinder + httpx for live recon", phase="recon")

    # LLM attack surface planning
    provider = _resolve_provider(campaign.get("provider_id"))
    prompt = _recon_prompt(campaign["target_url"])
    response = _llm_call(provider, [{"role": "user", "content": prompt}],
                         "You are a senior web security researcher. Respond only with valid JSON.")
    parsed = _parse_json(response)

    hypotheses = parsed.get("hypotheses", [])
    attack_surface = parsed.get("attack_surface", [])

    created = len(hypotheses)
    # Store hypotheses as a campaign event (no engagement_id available to insert into hypotheses table)
    if hypotheses:
        _append_event(campaign_id, "recon.hypotheses",
                      f"Identified {created} attack hypotheses",
                      phase="recon", detail={"hypotheses": hypotheses[:5], "tech_stack": parsed.get("tech_stack", [])})

    _append_event(campaign_id, "phase.done", f"Recon complete — {created} hypotheses, {len(attack_surface)} surface items",
                  phase="recon", detail={"hypotheses_count": created, "attack_surface_count": len(attack_surface)})
    _update_campaign(campaign_id, progress=30)

    ctx["attack_surface"] = attack_surface
    ctx["hypotheses"] = hypotheses
    return ctx


async def _phase_fuzz(campaign_id: str, campaign: dict, ctx: dict) -> dict:
    _update_campaign(campaign_id, phase="fuzz", progress=35)
    _append_event(campaign_id, "phase.change", "Starting fuzz/probe phase", phase="fuzz")

    # Queue nuclei and ffuf
    queue_tool_job(campaign_id, campaign["project_id"], "nuclei",
                   {"target": campaign["target_url"], "severity": "high,critical"})
    queue_tool_job(campaign_id, campaign["project_id"], "ffuf",
                   {"url": campaign["target_url"], "wordlist": "common.txt"})

    # LLM test case generation
    provider = _resolve_provider(campaign.get("provider_id"))
    prompt = _fuzz_prompt(
        campaign["target_url"],
        ctx.get("attack_surface", []),
        ctx.get("hypotheses", []),
    )
    response = _llm_call(provider, [{"role": "user", "content": prompt}],
                         "You are a web security tester. Respond only with valid JSON.")
    parsed = _parse_json(response)

    test_cases = parsed.get("test_cases", [])
    ctx["test_cases"] = test_cases

    _append_event(campaign_id, "phase.done", f"Fuzz phase complete — {len(test_cases)} test cases generated",
                  phase="fuzz", detail={"test_cases": len(test_cases)})
    _update_campaign(campaign_id, progress=55)
    return ctx


async def _phase_validate(campaign_id: str, campaign: dict, ctx: dict) -> dict:
    _update_campaign(campaign_id, phase="validate", progress=60)
    _append_event(campaign_id, "phase.change", "Starting validation phase", phase="validate")

    hypotheses = ctx.get("hypotheses", [])
    test_cases = ctx.get("test_cases", [])
    candidate_findings = hypotheses[:5]

    if not candidate_findings:
        ctx["verdicts"] = []
        _update_campaign(campaign_id, progress=80)
        return ctx

    provider = _resolve_provider(campaign.get("provider_id"))
    prompt = _validate_prompt(campaign["target_url"], candidate_findings)
    response = _llm_call(provider, [{"role": "user", "content": prompt}],
                         "You are a security finding validator. Respond only with valid JSON.")
    parsed = _parse_json(response)

    verdicts = parsed.get("verdicts", [])
    ctx["verdicts"] = verdicts

    # Update vulnerability records for confirmed/likely
    confirmed = 0
    for v in verdicts:
        if v.get("verdict") in ("confirmed", "likely") and v.get("report_worthy"):
            # Create a vulnerability record
            db.insert("vulnerabilities", {
                "id": str(uuid.uuid4()),
                "project_id": campaign["project_id"],
                "asset_id": None,
                "template_id": None,
                "name": v.get("title", "Unnamed finding")[:500],
                "severity": v.get("severity", "medium") if v.get("severity") in VALID_SEVERITIES else "medium",
                "category": "Campaign",
                "description": v.get("rationale", "")[:4000],
                "cve": None,
                "host": campaign["target_url"][:512],
                "matched_at": campaign["target_url"][:512],
                "status": "open",
                "verified": 1 if v.get("verdict") == "confirmed" else 0,
                "poc": json.dumps({"test_cases": test_cases, "confidence": v.get("confidence", 0)}),
                "request_chain": "[]",
                "tags": json.dumps(["campaign", campaign["hunt_type"]]),
                "dedup_key": f"campaign|{campaign_id}|{v.get('title', '')[:100]}",
                "sla_due": None,
                "detected_at": _now(),
                "fixed_at": None,
            })
            confirmed += 1

    db.execute(
        "UPDATE campaigns SET findings_count=? WHERE id=?",
        [confirmed, campaign_id],
    )
    _append_event(campaign_id, "phase.done",
                  f"Validation complete — {confirmed} report-worthy findings",
                  phase="validate", detail={"confirmed": confirmed, "total_verdicts": len(verdicts)})
    _update_campaign(campaign_id, progress=80)
    return ctx


async def _phase_source_scan(campaign_id: str, campaign: dict, ctx: dict) -> dict:
    _update_campaign(campaign_id, phase="source_scan", progress=15)
    _append_event(campaign_id, "phase.change", "Starting source review phase", phase="source_scan")

    provider = _resolve_provider(campaign.get("provider_id"))
    prompt = _source_scan_prompt(campaign["target_url"])
    response = _llm_call(provider, [{"role": "user", "content": prompt}],
                         "You are a source code security reviewer. Respond only with valid JSON.")
    parsed = _parse_json(response)

    hypotheses = parsed.get("hypotheses", [])
    ctx["hypotheses"] = hypotheses
    ctx["attack_surface"] = parsed.get("risk_patterns", [])

    # Store hypotheses in event log (hypotheses table requires engagement_id NOT NULL)
    if hypotheses:
        _append_event(campaign_id, "source.hypotheses",
                      f"Source review identified {len(hypotheses)} patterns",
                      phase="source_scan",
                      detail={"hypotheses": hypotheses[:5], "risk_patterns": parsed.get("risk_patterns", [])})

    _append_event(campaign_id, "phase.done",
                  f"Source scan complete — {len(hypotheses)} hypotheses identified",
                  phase="source_scan")
    _update_campaign(campaign_id, progress=65)
    return ctx


async def _phase_report(campaign_id: str, campaign: dict, ctx: dict) -> None:
    _update_campaign(campaign_id, phase="report", progress=85)
    _append_event(campaign_id, "phase.change", "Generating report", phase="report")

    verdicts = ctx.get("verdicts", [])
    # Merge test_steps from hypotheses into verdicts for the report
    hyp_map = {h.get("title", ""): h for h in ctx.get("hypotheses", [])}
    for v in verdicts:
        h = hyp_map.get(v.get("title", ""))
        if h:
            v.setdefault("test_steps", h.get("test_steps", []))

    fresh_campaign = get_campaign(campaign_id)
    report_md = _generate_report(fresh_campaign, verdicts or ctx.get("hypotheses", []))
    _update_campaign(campaign_id, report_md=report_md, progress=100)
    _append_event(campaign_id, "phase.done", "Report generated", phase="report",
                  detail={"report_length": len(report_md)})


# ── Main campaign runner ──────────────────────────────────────────────────────

async def run_campaign(campaign_id: str) -> None:
    """Async campaign runner. Called as a background task from the API."""
    import asyncio

    try:
        campaign = get_campaign(campaign_id)
    except ValueError:
        return

    if campaign["status"] not in ("queued", "running"):
        return

    _update_campaign(campaign_id, status="running", started_at=_now(), progress=5)
    _append_event(campaign_id, "campaign.started",
                  f"Campaign '{campaign['name']}' started on {campaign['target_url']}")
    hub.broadcast("campaign.started", {"id": campaign_id})

    phases = HUNT_PHASES.get(campaign["hunt_type"], HUNT_PHASES["full_auto"])
    ctx: dict = {}

    try:
        for phase in phases:
            # Check for cancellation before each phase
            current = db.query_one("SELECT status FROM campaigns WHERE id=?", [campaign_id])
            if current and current["status"] == "cancelled":
                return

            if phase == "recon":
                ctx = await _phase_recon(campaign_id, campaign, ctx)
            elif phase == "fuzz":
                ctx = await _phase_fuzz(campaign_id, campaign, ctx)
            elif phase == "validate":
                ctx = await _phase_validate(campaign_id, campaign, ctx)
            elif phase == "source_scan":
                ctx = await _phase_source_scan(campaign_id, campaign, ctx)
            elif phase == "report":
                await _phase_report(campaign_id, campaign, ctx)

            # Small yield so the event loop can process other tasks between phases
            await asyncio.sleep(0)

        _update_campaign(campaign_id, status="done", finished_at=_now(), progress=100)
        _append_event(campaign_id, "campaign.done",
                      f"Campaign complete — {campaign.get('findings_count', 0)} findings")
        hub.broadcast("campaign.done", {"id": campaign_id})

    except Exception as exc:  # noqa: BLE001
        err = str(exc)[:500]
        _update_campaign(campaign_id, status="failed", finished_at=_now(), error=err)
        _append_event(campaign_id, "campaign.failed", f"Campaign failed: {err}")
        hub.broadcast("campaign.failed", {"id": campaign_id, "error": err})
