"""Passive ToolSpec adapters for the local Caido helper toolkit."""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from . import toolspec


_READ_ONLY_SUBCOMMANDS = {
    "requests",
    "response",
    "auth",
    "findings",
    "ws",
    "sitemap",
    "search",
    "grep",
    "summary",
    "fingerprint",
    "export",
}


def _toolkit_dir() -> Path:
    configured = os.environ.get("CYBERBOX_BOUNTY_TOOLS_DIR")
    return Path(configured).expanduser().resolve() if configured else (
        Path.home() / "claude-bug-bounty" / "tools"
    ).resolve()


def _script(name: str) -> str | None:
    path = _toolkit_dir() / name
    return str(path) if path.is_file() else None


def _available(script_name: str) -> bool:
    return _toolkit_dir().is_dir() and _script(script_name) is not None


async def _run_script(script_name: str, argv: list[str], max_runtime: int) -> dict:
    """Run one toolkit script and always return a result dictionary."""
    script_path = _script(script_name)
    if script_path is None:
        return {"error": f"Caido toolkit script not found: {script_name}"}

    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            script_path,
            *argv,
            cwd=str(_toolkit_dir()),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=max_runtime)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            await proc.communicate()
            return {"error": f"{script_name} timed out after {max_runtime} seconds"}
    except FileNotFoundError as exc:
        return {"error": f"unable to start {script_name}: {exc}"}
    except Exception as exc:  # noqa: BLE001 - ToolSpec runners must never raise
        return {"error": f"{script_name} failed: {exc}"}

    stdout_text = stdout.decode("utf-8", errors="replace").strip()
    stderr_text = stderr.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0:
        detail = stderr_text or stdout_text or f"exit status {proc.returncode}"
        return {"error": f"{script_name} exited with status {proc.returncode}: {detail}"}

    try:
        parsed = json.loads(stdout_text)
    except (json.JSONDecodeError, TypeError):
        return {"text": stdout_text}
    return parsed if isinstance(parsed, dict) else {"data": parsed}


def _runner_result(result: dict) -> tuple[int, object]:
    return (1 if "error" in result else 0, result)


async def _run_caido_query(campaign_id, project_id: str, args: dict,
                           execution_id: str, phase: str,
                           max_runtime: int) -> tuple[int, object]:
    subcommand = args.get("subcommand") or "summary"
    if subcommand not in _READ_ONLY_SUBCOMMANDS:
        return (1, {"error": "subcommand not permitted (read-only only)"})

    argv: list[str] = []
    if args.get("project") is not None:
        argv.extend(["--project", str(args["project"])])
    argv.append(subcommand)
    if subcommand in {"search", "grep"} and args.get("query") is not None:
        argv.append(str(args["query"]))
    if args.get("host") is not None:
        argv.extend(["--host", str(args["host"])])
    if args.get("limit") is not None:
        argv.extend(["--limit", str(args["limit"])])

    return _runner_result(await _run_script("caido_db.py", argv, max_runtime))


async def _run_caido_jwt(campaign_id, project_id: str, args: dict,
                         execution_id: str, phase: str,
                         max_runtime: int) -> tuple[int, object]:
    host = args.get("host")
    if not host:
        return (1, {"error": "host required"})
    argv = ["--host", str(host), "--out", "json"]
    if args.get("project") is not None:
        argv.extend(["--project", str(args["project"])])
    return _runner_result(await _run_script("caido_jwt_extract.py", argv, max_runtime))


async def _run_caido_harvest(campaign_id, project_id: str, args: dict,
                             execution_id: str, phase: str,
                             max_runtime: int) -> tuple[int, object]:
    # caido_flow.py harvest does not accept --host, so do not forward that optional arg.
    return _runner_result(await _run_script("caido_flow.py", ["harvest"], max_runtime))


async def _run_caido_analyze(campaign_id, project_id: str, args: dict,
                             execution_id: str, phase: str,
                             max_runtime: int) -> tuple[int, object]:
    return _runner_result(await _run_script("caido_analyzer.py", ["analyze"], max_runtime))


_SPECS = (
    ("caido_query", "Read-only queries against the local Caido project database."),
    ("caido_jwt", "Extract JWT metadata from locally captured Caido traffic."),
    ("caido_harvest", "Harvest passive intelligence from the local Caido traffic database."),
    ("caido_analyze", "Analyze locally captured Caido traffic for security signals."),
)

for _name, _description in _SPECS:
    toolspec.register(toolspec.ToolSpec(
        name=_name,
        category="intel",
        danger_tier="passive",
        scope_required=0,
        description=_description,
        modes=("manual", "ai"),
        covers=(),
        phase="recon",
    ))

toolspec.bind_runner(
    "caido_query", _run_caido_query, available=lambda: _available("caido_db.py"))
toolspec.bind_runner(
    "caido_jwt", _run_caido_jwt, available=lambda: _available("caido_jwt_extract.py"))
toolspec.bind_runner(
    "caido_harvest", _run_caido_harvest, available=lambda: _available("caido_flow.py"))
toolspec.bind_runner(
    "caido_analyze", _run_caido_analyze, available=lambda: _available("caido_analyzer.py"))
