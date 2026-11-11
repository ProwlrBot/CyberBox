"""Async tool runner — polls executions table for tool:* jobs and runs them.

Supported kinds: tool:subfinder, tool:httpx, tool:nuclei, tool:ffuf.
Each job is leased, executed via asyncio subprocess, then marked done/failed.
Findings from nuclei are written directly to the vulnerabilities table.
"""
from __future__ import annotations

import asyncio
import json
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .. import db
from . import campaign as campaign_svc

_POLL_INTERVAL = 5          # seconds between polls
_LEASE_MINUTES = 5          # lease duration per job
_MAX_CONCURRENT = 3         # parallel tool jobs
_DEFAULT_MAX_RUNTIME = 1800 # seconds

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

async def _run_tool_job(execution_id: str) -> None:
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
    if tool_name == "subfinder":
        return await _run_subfinder(campaign_id, project_id, args, execution_id, phase, max_runtime)
    if tool_name == "httpx":
        return await _run_httpx(campaign_id, project_id, args, execution_id, phase, max_runtime)
    if tool_name == "nuclei":
        return await _run_nuclei(campaign_id, project_id, args, execution_id, phase, max_runtime)
    if tool_name == "ffuf":
        return await _run_ffuf(campaign_id, project_id, args, execution_id, phase, max_runtime)
    raise ValueError(f"Unknown tool: {tool_name}")


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
    subdomains: list[str] | None = None,
) -> tuple[int, list[dict]]:
    hosts = subdomains or args.get("hosts", [])
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
    wordlist = args.get("wordlist", "/usr/share/wordlists/dirb/common.txt")

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
    template_id = obj.get("template-id", "unknown")
    matched_at = obj.get("matched-at", "")
    info = obj.get("info", {})
    name = info.get("name") or template_id
    severity = (info.get("severity") or "info").lower()
    description = info.get("description", "")
    host = obj.get("host", "")

    tags = ["nuclei", "auto"]
    if campaign_id:
        tags.append(campaign_id)

    dedup_key = f"nuclei|{template_id}|{matched_at}"
    row = {
        "id":          str(uuid.uuid4()),
        "project_id":  project_id,
        "name":        name[:500],
        "severity":    severity,
        "category":    "Nuclei",
        "description": description[:4000],
        "template_id": template_id,
        "host":        host[:500],
        "matched_at":  matched_at[:500],
        "status":      "open",
        "verified":    0,
        "poc":         "",
        "request_chain": "[]",
        "tags":        json.dumps(tags),
        "dedup_key":   dedup_key,
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
