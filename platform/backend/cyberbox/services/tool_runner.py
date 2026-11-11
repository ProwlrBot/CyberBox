"""Async tool runner — polls executions table for tool:* jobs and runs them.

Supported kinds: tool:subfinder, tool:httpx, tool:nuclei, tool:ffuf.
Each job is leased, executed via asyncio subprocess, then marked done/failed.
Findings from nuclei are written directly to the vulnerabilities table.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .. import db
from . import campaign as campaign_svc
from . import policy as policy_svc
from . import scanner
from . import tool_registry
from . import toolspec

_POLL_INTERVAL = 5          # seconds between polls
_LEASE_MINUTES = 5          # lease duration per job
_MAX_CONCURRENT = 3         # parallel tool jobs
_DEFAULT_MAX_RUNTIME = 1800 # seconds
# Default ffuf wordlist; per-job `args["wordlist"]` overrides, env sets the fallback.
_DEFAULT_FFUF_WORDLIST = os.environ.get(
    "CYBERBOX_FFUF_WORDLIST", "/usr/share/wordlists/dirb/common.txt")

PROGRESS_AFTER: dict[str, int] = {
    "subfinder": 20,
    "httpx":     35,
    "nuclei":    70,
    "ffuf":      85,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _lease_until() -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=_LEASE_MINUTES)).isoformat()


# ── Main loop ─────────────────────────────────────────────────────────────────

async def start_runner() -> None:
    """Main loop — call once on app startup. Polls every _POLL_INTERVAL seconds."""
    while True:
        try:
            await _poll_and_dispatch()
        except Exception:  # noqa: BLE001 — keep runner alive on unexpected errors
            pass
        await asyncio.sleep(_POLL_INTERVAL)


async def _poll_and_dispatch() -> None:
    """Find up to _MAX_CONCURRENT queued tool jobs, lease and run each concurrently."""
    now = _now()
    rows = db.query(
        """
        SELECT id FROM executions
        WHERE kind LIKE 'tool:%'
          AND (
            status = 'queued'
            OR (status = 'running' AND lease_expires_at < ?)
          )
        LIMIT ?
        """,
        [now, _MAX_CONCURRENT],
    )
    if not rows:
        return
    await asyncio.gather(*[_run_tool_job(r["id"]) for r in rows])


# ── Job orchestration ──────────────────────────────────────────────────────────

async def run_job(execution_id: str, operator_approved: bool = False) -> None:
    """Public entrypoint — run one queued tool execution to completion synchronously.

    Used by the manual run route so an operator-triggered tool goes through the exact same
    lease → policy-gate → dispatch → finish path as the autonomous runner. `operator_approved`
    marks that a human explicitly triggered this run: the gate then treats an
    "approval-required" decision as satisfied (the click IS the approval) for everything below
    the destructive tier, while hard scope denials and destructive/prohibited risk still block.
    The autonomy dial governs the UNATTENDED (AI) path; it does not fence off what an operator
    deliberately runs."""
    await _run_tool_job(execution_id, operator_approved=operator_approved)


async def _run_tool_job(execution_id: str, operator_approved: bool = False) -> None:
    """Lease, run, stream output, mark done/failed. All errors are caught."""
    row = db.query_one("SELECT * FROM executions WHERE id=?", [execution_id])
    if not row or row["status"] not in ("queued", "running"):
        return

    # Acquire lease
    db.execute(
        "UPDATE executions SET status='running', lease_owner='tool_runner', "
        "lease_expires_at=?, attempt=attempt+1, started_at=COALESCE(started_at,?) WHERE id=?",
        [_lease_until(), _now(), execution_id],
    )

    payload = json.loads(row["input"])
    tool_name = payload.get("tool", row["kind"].removeprefix("tool:"))
    campaign_id: str | None = payload.get("campaign_id")
    project_id: str = row["project_id"]
    args: dict = payload.get("args", {})

    # Resolve max_runtime from campaign (or default)
    max_runtime = _DEFAULT_MAX_RUNTIME
    if campaign_id:
        try:
            c = campaign_svc.get_campaign(campaign_id)
            max_runtime = int(c.get("max_runtime") or _DEFAULT_MAX_RUNTIME)
        except Exception:  # noqa: BLE001
            pass

    phase = args.get("phase") or _guess_phase(tool_name)

    # ── Scope/authorization gate — default-deny before any live tool runs ──
    engagement_id = row["engagement_id"]
    gate = _policy_gate(engagement_id, tool_name, args, operator_approved=operator_approved)
    if not gate["allowed"]:
        msg = f"blocked by policy: {gate['reason']}"
        _finish_execution(execution_id, project_id, "blocked", {"policy": gate}, msg)
        if campaign_id:
            _campaign_event(campaign_id, "tool.blocked",
                            f"{tool_name} blocked — {gate['reason']}", phase,
                            {"execution_id": execution_id, "tool": tool_name})
        return

    try:
        rc, result = await _dispatch_tool(
            tool_name, campaign_id, project_id, args, execution_id, phase, max_runtime
        )
        output = {"tool": tool_name, "returncode": rc, "result": result}
        _finish_execution(execution_id, project_id, "done", output)

        # Update campaign progress
        if campaign_id and rc == 0 and tool_name in PROGRESS_AFTER:
            try:
                campaign_svc._update_campaign(campaign_id, progress=PROGRESS_AFTER[tool_name])
                _campaign_event(campaign_id, "tool.done",
                                f"{tool_name} finished (exit {rc})", phase,
                                {"execution_id": execution_id, "tool": tool_name})
            except Exception:  # noqa: BLE001
                pass

    except FileNotFoundError:
        msg = f"Tool `{tool_name}` not found — install it in PATH"
        _finish_execution(execution_id, project_id, "failed", {}, msg)
        if campaign_id:
            _campaign_event(campaign_id, "tool.error", msg, phase,
                            {"execution_id": execution_id, "tool": tool_name})

    except asyncio.TimeoutError:
        msg = f"Tool `{tool_name}` timed out after {max_runtime}s"
        _finish_execution(execution_id, project_id, "failed", {}, msg)
        if campaign_id:
            _campaign_event(campaign_id, "tool.error", msg, phase,
                            {"execution_id": execution_id, "tool": tool_name})

    except Exception as exc:  # noqa: BLE001
        msg = str(exc)[:2000]
        _finish_execution(execution_id, project_id, "failed", {}, msg)
        if campaign_id:
            _campaign_event(campaign_id, "tool.error",
                            f"{tool_name} failed: {msg}", phase,
                            {"execution_id": execution_id, "tool": tool_name})


def _finish_execution(execution_id: str, project_id: str,
                      status: str, output: dict, error: str | None = None) -> None:
    db.execute(
        "UPDATE executions SET status=?, output=?, error=?, finished_at=?, "
        "lease_owner=NULL, lease_expires_at=NULL WHERE id=?",
        [status, json.dumps(output), error, _now(), execution_id],
    )


def _campaign_event(campaign_id: str, event_type: str, summary: str,
                    phase: str | None, detail: dict) -> None:
    try:
        campaign_svc._append_event(campaign_id, event_type, summary, phase, detail)
    except Exception:  # noqa: BLE001
        pass


def _guess_phase(tool_name: str) -> str:
    return {"subfinder": "recon", "httpx": "recon",
            "nuclei": "fuzz", "ffuf": "fuzz"}.get(tool_name, "recon")


def _target_url(args: dict) -> str | None:
    """Best-effort target URL for policy evaluation from a tool's args."""
    url = args.get("target_url") or args.get("url")
    if url:
        return url if "://" in url else f"https://{url}"
    domain = args.get("domain") or args.get("target") or args.get("host")
    return f"https://{domain}" if domain else None


def _policy_gate(engagement_id: str | None, tool_name: str, args: dict,
                 operator_approved: bool = False) -> dict:
    """Default-deny gate. No engagement, no target, or policy denial → not allowed.

    This is the single enforcement point for BOTH paths: every tool the runner dispatches —
    autonomous or operator-triggered — passes through here, so nothing reaches a live tool
    without an authorized engagement whose scope covers the target.

    Spec-aware: a scope_required=0 passive tool (intel API, no target) skips the target check.
    operator_approved=True means a human explicitly triggered this run, so an approval-required
    decision is satisfied for everything below the destructive tier; hard scope denials and
    destructive/prohibited risk still block regardless.
    """
    if not engagement_id:
        return {"allowed": False, "reason": "no engagement — run is unauthorized"}
    spec = toolspec.get(tool_name)
    if spec is not None and spec.scope_required == 0 and spec.danger_tier == "passive":
        return {"allowed": True, "reason": "passive intel tool — no target scope required"}
    url = _target_url(args)
    if not url:
        return {"allowed": False, "reason": "no resolvable target to scope-check"}
    risk = tool_registry.risk_class_for(tool_name)  # registry-driven, conservative fallback
    try:
        decision = policy_svc.evaluate(engagement_id, url, method="GET", risk_class=risk)
    except Exception as exc:  # noqa: BLE001 — a failing policy check must deny, not pass
        return {"allowed": False, "reason": f"policy evaluation error: {exc}"}
    if not decision.get("allowed"):
        return {"allowed": False, "reason": decision.get("reason", "policy denied")}
    if decision.get("requires_approval"):
        below_destructive = (policy_svc.RISK_ORDER.get(risk, 99)
                             < policy_svc.RISK_ORDER["destructive"])
        if operator_approved and below_destructive:
            return {"allowed": True, "reason": "operator-approved live action"}
        return {"allowed": False, "reason": "requires operator approval"}
    return {"allowed": True, "reason": decision.get("reason", "policy allowed")}


# ── Tool dispatcher ────────────────────────────────────────────────────────────

async def _dispatch_tool(
    tool_name: str,
    campaign_id: str | None,
    project_id: str,
    args: dict,
    execution_id: str,
    phase: str,
    max_runtime: int,
) -> tuple[int, object]:
    """Resolve the tool's ToolSpec and run its bound runner. No hardcoded tool list —
    any spec with a runner (and 'ai' in its modes) is dispatchable here."""
    spec = toolspec.get(tool_name)
    if spec is None or spec.runner is None:
        raise ValueError(f"Unknown or non-executable tool: {tool_name}")
    if not spec.allows_mode("ai"):
        raise ValueError(f"Tool {tool_name} is not available to the autonomous runner")
    return await spec.runner(campaign_id, project_id, args, execution_id, phase, max_runtime)


# ── Individual tools ───────────────────────────────────────────────────────────

async def _run_subfinder(
    campaign_id: str | None,
    project_id: str,
    args: dict,
    execution_id: str,
    phase: str,
    max_runtime: int,
) -> tuple[int, list[str]]:
    domain = args.get("domain", args.get("target_url", ""))
    cmd = ["subfinder", "-d", domain, "-silent", "-json"]

    subdomains: list[str] = []
    lines: list[str] = []

    async def on_line(line: str) -> None:
        lines.append(line)
        try:
            obj = json.loads(line)
            host = obj.get("host") or obj.get("subdomain") or line
            subdomains.append(host)
            if campaign_id:
                _campaign_event(campaign_id, "tool_output",
                                f"[subfinder] {host}", phase,
                                {"execution_id": execution_id, "tool": "subfinder"})
        except json.JSONDecodeError:
            if line and campaign_id:
                _campaign_event(campaign_id, "tool_output",
                                f"[subfinder] {line}", phase,
                                {"execution_id": execution_id, "tool": "subfinder"})

    rc = await _stream_subprocess(cmd, on_line, max_runtime)
    return rc, subdomains


async def _run_httpx(
    campaign_id: str | None,
    project_id: str,
    args: dict,
    execution_id: str,
    phase: str,
    max_runtime: int,
) -> tuple[int, list[dict]]:
    hosts = args.get("hosts", [])
    if not hosts:
        target = args.get("target_url", args.get("domain", ""))
        hosts = [target] if target else []

    live_hosts: list[dict] = []

    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        tmpfile = f.name
        f.write("\n".join(hosts))

    cmd = ["httpx", "-list", tmpfile, "-silent", "-json", "-status-code", "-tech-detect"]

    async def on_line(line: str) -> None:
        try:
            obj = json.loads(line)
            live_hosts.append(obj)
            url = obj.get("url") or obj.get("input") or line
            status = obj.get("status_code", "")
            if campaign_id:
                _campaign_event(campaign_id, "tool_output",
                                f"[httpx] {url} {status}", phase,
                                {"execution_id": execution_id, "tool": "httpx"})
        except json.JSONDecodeError:
            if line and campaign_id:
                _campaign_event(campaign_id, "tool_output",
                                f"[httpx] {line}", phase,
                                {"execution_id": execution_id, "tool": "httpx"})

    rc = await _stream_subprocess(cmd, on_line, max_runtime)
    try:
        Path(tmpfile).unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass
    return rc, live_hosts


async def _run_nuclei(
    campaign_id: str | None,
    project_id: str,
    args: dict,
    execution_id: str,
    phase: str,
    max_runtime: int,
) -> tuple[int, int]:
    target_url = args.get("target_url", args.get("url", ""))
    cmd = [
        "nuclei", "-u", target_url,
        "-severity", "medium,high,critical",
        "-json", "-silent",
    ]

    finding_count = 0

    async def on_line(line: str) -> None:
        nonlocal finding_count
        try:
            obj = json.loads(line)
            finding_count += 1
            _insert_nuclei_finding(obj, project_id, campaign_id)
            name = obj.get("info", {}).get("name", obj.get("template-id", "finding"))
            severity = obj.get("info", {}).get("severity", "info")
            matched = obj.get("matched-at", "")
            if campaign_id:
                _campaign_event(campaign_id, "finding.detected",
                                f"[nuclei] {severity.upper()} {name} @ {matched}", phase,
                                {"execution_id": execution_id, "tool": "nuclei",
                                 "template_id": obj.get("template-id")})
        except json.JSONDecodeError:
            if line and campaign_id:
                _campaign_event(campaign_id, "tool_output",
                                f"[nuclei] {line}", phase,
                                {"execution_id": execution_id, "tool": "nuclei"})

    rc = await _stream_subprocess(cmd, on_line, max_runtime)
    return rc, finding_count


async def _run_ffuf(
    campaign_id: str | None,
    project_id: str,
    args: dict,
    execution_id: str,
    phase: str,
    max_runtime: int,
) -> tuple[int, int]:
    target_url = args.get("target_url", args.get("url", ""))
    wordlist = args.get("wordlist") or _DEFAULT_FFUF_WORDLIST

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        outfile = f.name

    cmd = [
        "ffuf",
        "-u", f"{target_url}/FUZZ",
        "-w", wordlist,
        "-of", "json",
        "-o", outfile,
        "-silent",
    ]

    path_count = 0

    async def on_line(line: str) -> None:
        if line and campaign_id:
            _campaign_event(campaign_id, "tool_output",
                            f"[ffuf] {line}", phase,
                            {"execution_id": execution_id, "tool": "ffuf"})

    rc = await _stream_subprocess(cmd, on_line, max_runtime)

    try:
        data = json.loads(Path(outfile).read_text())
        results = data.get("results", [])
        path_count = len(results)
        for r in results:
            url = r.get("url", "")
            status = r.get("status", "")
            if campaign_id:
                _campaign_event(campaign_id, "tool_output",
                                f"[ffuf] {status} {url}", phase,
                                {"execution_id": execution_id, "tool": "ffuf"})
    except Exception:  # noqa: BLE001
        pass

    try:
        Path(outfile).unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass

    return rc, path_count


# ── Subprocess streaming ───────────────────────────────────────────────────────

async def _stream_subprocess(
    cmd: list[str],
    on_line,
    max_runtime: int,
) -> int:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )

    async def _read_stdout() -> None:
        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip()
            if line.strip():
                await on_line(line)

    try:
        await asyncio.wait_for(
            asyncio.gather(_read_stdout(), proc.wait()),
            timeout=max_runtime,
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise

    return proc.returncode or 0


# ── Finding insertion ──────────────────────────────────────────────────────────

def _insert_nuclei_finding(obj: dict, project_id: str, campaign_id: str | None) -> None:
    # Share the scan path's parser so a given record yields the same dedup_key,
    # category, cve and tags regardless of which path ingested it. The campaign path
    # stays verified=0 (no inline outbound PoC check) and adds campaign provenance tags.
    f = scanner.parse_nuclei_record(obj)
    tags = [*f["tags"], "auto"]
    if campaign_id:
        tags.append(campaign_id)
    row = {
        "id":          str(uuid.uuid4()),
        "project_id":  project_id,
        "name":        f["name"][:500],
        "severity":    f["severity"],
        "category":    f["category"],
        "description": f["description"][:4000],
        "template_id": f["template_id"],
        "cve":         f["cve"],
        "host":        f["host"][:500],
        "matched_at":  f["matched_at"][:500],
        "status":      "open",
        "verified":    0,
        "poc":         "",
        "request_chain": "[]",
        "tags":        json.dumps(tags),
        "dedup_key":   f["dedup_key"],
        "detected_at": _now(),
    }

    cols = ", ".join(row.keys())
    placeholders = ", ".join("?" for _ in row)
    try:
        db.execute(
            f"INSERT OR IGNORE INTO vulnerabilities ({cols}) VALUES ({placeholders})",
            list(row.values()),
        )
        # Bump campaign findings_count if this was a new insert
        if campaign_id:
            db.execute(
                "UPDATE campaigns SET findings_count = findings_count + 1 "
                "WHERE id=? AND findings_count < (SELECT COUNT(*) FROM vulnerabilities WHERE project_id=?)",
                [campaign_id, project_id],
            )
    except Exception:  # noqa: BLE001 — dedup races are silently ignored
        pass


# ── Bind executable runners to their specs ──────────────────────────────────────
# The ToolSpec metadata is declared in toolspec.py; here we attach the async handler
# so both the AI dispatcher (above) and the manual run route resolve the same spec.
toolspec.bind_runner("subfinder", _run_subfinder)
toolspec.bind_runner("httpx", _run_httpx)
toolspec.bind_runner("nuclei", _run_nuclei)
toolspec.bind_runner("ffuf", _run_ffuf)
