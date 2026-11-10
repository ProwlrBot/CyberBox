"""Agent fleet: sandboxed Docker containers, egress IP visibility.

Provider and model are looked up from the `model_providers` table at spawn
time — not hardcoded. Pass provider_id="lmstudio" (or any registered id)
and optionally a model override; fallback to the project's default provider
when neither is supplied.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from datetime import datetime, timezone

from .. import db
from ..hub import hub
from . import model as model_svc

SANDBOX_IMAGE = os.environ.get("CYBERBOX_SANDBOX_IMAGE", "ghcr.io/prowlrbot/cybersandbox:latest")
AGENT_TYPES = ["recon", "web", "api", "cloud", "pr-review", "fuzzer", "crawler", "triage"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_provider() -> str:
    """Return the first enabled local provider, then any enabled provider."""
    rows = db.query(
        "SELECT id FROM model_providers WHERE enabled=1 ORDER BY local DESC, name LIMIT 1"
    )
    return rows[0]["id"] if rows else "lmstudio"


def egress_ip() -> str:
    import urllib.request
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=5) as r:  # noqa: S310
            return r.read().decode().strip()
    except Exception:  # noqa: BLE001
        return "unavailable (offline)"


def spawn_agent(
    name: str,
    agent_type: str,
    task_id: str | None,
    provider_id: str | None = None,
    model: str | None = None,
) -> dict:
    if not provider_id:
        provider_id = _default_provider()

    # Validate provider exists (raises ValueError if not)
    try:
        cfg = model_svc.get_provider(provider_id)
        effective_model = model or cfg.get("default_model") or ""
    except ValueError:
        cfg = {}
        effective_model = model or ""

    agent_id = str(uuid.uuid4())
    sandbox_id = None
    status = "idle"
    if shutil.which("docker"):
        try:
            proc = subprocess.run(
                ["docker", "run", "-d", "--rm", "--network", "bridge",
                 "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                 "--memory", "2g", "--cpus", "1",
                 "--label", f"cyberbox.agent={agent_id}",
                 "--label", f"cyberbox.type={agent_type}",
                 SANDBOX_IMAGE, "sleep", "infinity"],
                capture_output=True, text=True, timeout=60)
            if proc.returncode == 0:
                sandbox_id = proc.stdout.strip()[:12]
                status = "running"
        except Exception:  # noqa: BLE001
            pass

    agent = {
        "id":         agent_id,
        "name":       name,
        "type":       agent_type,
        "status":     status,
        "task_id":    task_id,
        "sandbox_id": sandbox_id,
        "provider":   provider_id,
        "model":      effective_model,
        "egress_ip":  egress_ip(),
        "created_at": _now(),
    }
    db.insert("agents", agent)
    hub.broadcast("agent.spawned", {"id": agent_id, "name": name, "type": agent_type,
                                    "provider": provider_id, "model": effective_model})
    return agent


def stop_agent(agent_id: str) -> None:
    agent = db.query_one("SELECT * FROM agents WHERE id=?", [agent_id])
    if agent and agent["sandbox_id"] and shutil.which("docker"):
        subprocess.run(["docker", "rm", "-f", agent["sandbox_id"]], capture_output=True, timeout=30)
    db.execute("UPDATE agents SET status='done' WHERE id=?", [agent_id])
    hub.broadcast("agent.stopped", {"id": agent_id})


def spawn_fleet(
    prefix: str,
    agent_type: str,
    count: int,
    task_id: str | None,
    provider_id: str | None = None,
) -> list[dict]:
    return [spawn_agent(f"{prefix}-{i+1}", agent_type, task_id, provider_id) for i in range(count)]


def run_task(
    agent_id: str,
    messages: list[dict],
    system: str | None = None,
    max_tokens: int = 2048,
    allow_external: bool = False,
) -> str:
    """Call the agent's configured model with a messages list and return the text."""
    agent = db.query_one("SELECT * FROM agents WHERE id=?", [agent_id])
    if not agent:
        raise ValueError(f"agent not found: {agent_id}")
    return model_svc.complete(
        messages=messages,
        provider_id=agent["provider"],
        model=agent["model"] or None,
        system=system,
        max_tokens=max_tokens,
        allow_external=allow_external,
    )
