"""Agent fleet: sandboxed Docker containers, egress IP visibility."""
from __future__ import annotations

import shutil
import subprocess
import uuid
from datetime import datetime, timezone

from .. import db
from ..hub import hub

SANDBOX_IMAGE = "ghcr.io/prowlrbot/cybersandbox:latest"
AGENT_TYPES = ["recon", "web", "api", "cloud", "pr-review", "fuzzer", "crawler", "triage"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def egress_ip() -> str:
    import urllib.request
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=5) as r:  # noqa: S310
            return r.read().decode().strip()
    except Exception:  # noqa: BLE001
        return "unavailable (offline)"


def spawn_agent(name: str, agent_type: str, task_id: str | None,
                provider: str = "ollama", model: str = "") -> dict:
    agent_id = str(uuid.uuid4())
    sandbox_id = None
    status = "idle"
    if shutil.which("docker"):
        try:
            proc = subprocess.run(
                ["docker", "run", "-d", "--rm", "--network", "bridge",
                 "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                 "--memory", "2g", "--cpus", "1", "--label", f"neo.agent={agent_id}",
                 SANDBOX_IMAGE, "sleep", "infinity"],
                capture_output=True, text=True, timeout=60)
            if proc.returncode == 0:
                sandbox_id = proc.stdout.strip()[:12]
                status = "running"
        except Exception:  # noqa: BLE001
            pass
    agent = {"id": agent_id, "name": name, "type": agent_type, "status": status,
             "task_id": task_id, "sandbox_id": sandbox_id, "provider": provider,
             "model": model, "egress_ip": egress_ip(), "created_at": _now()}
    db.insert("agents", agent)
    hub.broadcast("agent.spawned", {"id": agent_id, "name": name, "type": agent_type})
    return agent


def stop_agent(agent_id: str) -> None:
    agent = db.query_one("SELECT * FROM agents WHERE id=?", [agent_id])
    if agent and agent["sandbox_id"] and shutil.which("docker"):
        subprocess.run(["docker", "rm", "-f", agent["sandbox_id"]], capture_output=True, timeout=30)
    db.execute("UPDATE agents SET status='done' WHERE id=?", [agent_id])
    hub.broadcast("agent.stopped", {"id": agent_id})


def spawn_fleet(prefix: str, agent_type: str, count: int, task_id: str | None) -> list[dict]:
    return [spawn_agent(f"{prefix}-{i+1}", agent_type, task_id) for i in range(count)]
