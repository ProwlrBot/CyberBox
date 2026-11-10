"""Real scanning pipeline: subfinder -> httpx -> nuclei. No mock fallback."""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .. import db
from ..config import get_settings
from ..hub import hub
from . import verify

logger = logging.getLogger(__name__)

RAPTOR_PROTOCOLS = frozenset([
    "mcp", "pkg", "skill", "pypi", "go", "gitlab", "ruby",
    "java", "php", "gha", "github", "js", "crystal",
])

# Default location; overridable via settings.tools["raptor"]
_RAPTOR_DEFAULT = "/home/anon/raptor/raptor"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tool(name: str) -> str | None:
    path = get_settings().tools.get(name, name)
    return path if shutil.which(path) else None


def _append_log(scan_id: str, line: str) -> None:
    db.execute("UPDATE scans SET log = log || ? WHERE id=?", [line + "\n", scan_id])
    hub.broadcast("scan.log", {"scan_id": scan_id, "line": line})


def _run(cmd: list[str], scan_id: str, timeout: int = 600) -> list[str]:
    _append_log(scan_id, f"$ {' '.join(cmd)}")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        _append_log(scan_id, f"[timeout after {timeout}s]")
        return []
    for ln in (proc.stderr or "").strip().splitlines()[-5:]:
        _append_log(scan_id, f"  {ln}")
    return [ln for ln in proc.stdout.splitlines() if ln.strip()]


def discover_hosts(target: str, scan_id: str) -> list[str]:
    hosts = {target}
    sf = _tool("subfinder")
    if sf:
        for line in _run([sf, "-d", target, "-silent"], scan_id, timeout=300):
            hosts.add(line.strip())
    else:
        _append_log(scan_id, "[subfinder not installed — only scanning the seed target]")
    return sorted(hosts)


def probe_hosts(project_id: str, hosts: list[str], scan_id: str) -> list[dict]:
    hx = _tool("httpx")
    assets: list[dict] = []
    now = _now()
    if not hx:
        _append_log(scan_id, "[httpx not installed — cannot probe hosts]")
        return assets
    cmd = [hx, "-silent", "-json", "-status-code", "-tech-detect", "-title", "-ip", "-cname", "-asn"]
    proc = subprocess.run(cmd, input="\n".join(hosts), capture_output=True, text=True, timeout=600)
    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        url = rec.get("url", "")
        scheme = "https" if url.startswith("https") else "http"
        host = rec.get("input") or rec.get("host") or url
        port = int(rec.get("port") or (443 if scheme == "https" else 80))
        asset = {
            "id": str(uuid.uuid4()), "project_id": project_id, "group_id": None,
            "host": host, "port": port, "scheme": scheme,
            "status_code": rec.get("status_code"),
            "ip": (rec.get("a") or [None])[0] if isinstance(rec.get("a"), list) else None,
            "asn": (rec.get("asn") or {}).get("as_number") if isinstance(rec.get("asn"), dict) else None,
            "cname": (rec.get("cname") or [None])[0] if isinstance(rec.get("cname"), list) else None,
            "service": scheme,
            "technologies": json.dumps(rec.get("tech", []) or []),
            "labels": "[]",
            "metadata": json.dumps({"title": rec.get("title", ""), "webserver": rec.get("webserver", "")}),
            "first_seen": now, "last_seen": now,
        }
        db.upsert("assets", asset, conflict_cols=["project_id", "host", "port", "scheme"],
                  update_cols=["status_code", "ip", "asn", "technologies", "metadata", "last_seen"])
        assets.append(asset)
        _append_log(scan_id, f"  [asset] {host}:{port} {rec.get('status_code')}")
        hub.broadcast("asset.found", {"host": host, "port": port})
    return assets


CATEGORY_MAP = {
    "docker": "Exposed Docker & K8s", "kubernetes": "Exposed Docker & K8s",
    "ssrf": "Cloud Metadata Endpoints", "aws": "AWS Keys Exposure",
    "secret": "Secrets Exposure", "exposure": "Secrets Exposure",
    "redirect": "Open Redirect", "idor": "Broken Access Control",
    "auth": "Broken Authentication", "sqli": "SQL Injection",
    "xss": "Cross-Site Scripting", "rce": "Remote Code Execution",
}


def _category_for(rec: dict) -> str:
    tags = rec.get("info", {}).get("tags", "")
    tag_str = ",".join(tags) if isinstance(tags, list) else str(tags)
    for key, cat in CATEGORY_MAP.items():
        if key in tag_str.lower() or key in rec.get("template-id", "").lower():
            return cat
    return "Misconfiguration"


def _ingest_finding(project_id: str, task_id: str | None, rec: dict, scan_id: str) -> bool:
    info = rec.get("info", {})
    severity = (info.get("severity") or "info").lower()
    template_id = rec.get("template-id") or "unknown"
    matched_at = rec.get("matched-at") or rec.get("host", "")
    host = rec.get("host", "")
    name = info.get("name", template_id)
    cve = None
    cve_ids = (info.get("classification") or {}).get("cve-id") or []
    if cve_ids:
        cve = cve_ids[0] if isinstance(cve_ids, list) else cve_ids
    dedup_key = f"{template_id}|{matched_at}"
    if db.query_one("SELECT id FROM vulnerabilities WHERE project_id=? AND dedup_key=?",
                    [project_id, dedup_key]):
        return False
    engagement = db.query_one(
        "SELECT id FROM engagements WHERE project_id=? AND status='active' ORDER BY created_at DESC LIMIT 1",
        [project_id],
    )
    verified, poc, chain = verify.verify_finding(
        template_id, matched_at, rec, engagement["id"] if engagement else None)
    sla = db.query_one("SELECT days FROM sla_policy WHERE severity=?", [severity])
    sla_due = (datetime.now(timezone.utc) + timedelta(days=sla["days"])).isoformat() if sla else None
    asset = db.query_one(
        "SELECT id FROM assets WHERE project_id=? AND ? LIKE '%' || host || '%' LIMIT 1",
        [project_id, host])
    vuln = {
        "id": str(uuid.uuid4()), "project_id": project_id,
        "asset_id": asset["id"] if asset else None, "template_id": template_id,
        "name": name, "severity": severity, "category": _category_for(rec),
        "description": info.get("description", ""), "cve": cve,
        "host": host, "matched_at": matched_at, "status": "open",
        "verified": 1 if verified else 0, "poc": poc,
        "request_chain": json.dumps(chain),
        "tags": json.dumps(info.get("tags", []) if isinstance(info.get("tags"), list)
                           else str(info.get("tags", "")).split(",")),
        "dedup_key": dedup_key, "sla_due": sla_due, "detected_at": _now(), "fixed_at": None,
    }
    db.insert("vulnerabilities", vuln)
    _append_log(scan_id, f"  [{severity.upper()}] {name} @ {matched_at} verified={verified}")
    hub.broadcast("vuln.found", {"name": name, "severity": severity, "verified": verified, "host": host})
    return True


def run_nuclei(project_id: str, scan_id: str, task_id: str | None, targets: list[str]) -> int:
    nu = _tool("nuclei")
    if not nu:
        _append_log(scan_id, "[nuclei not installed — skipping vulnerability scan]")
        return 0
    cmd = [nu, "-silent", "-jsonl", "-severity", "critical,high,medium,low,info", "-no-color"]
    proc = subprocess.run(cmd, input="\n".join(targets), capture_output=True, text=True, timeout=1800)
    count = 0
    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if _ingest_finding(project_id, task_id, rec, scan_id):
            count += 1
    return count


def run_raptor_scan(
    project_id: str,
    engagement_id: str,
    protocol: str,
    target_path: str,
    created_by: str,
    output_format: str = "jsonl",
) -> dict:
    """Run Raptor source scanner and return structured results.

    Returns {"execution_id": str, "findings_count": int, "output_lines": list[str]}.
    Raises RuntimeError if raptor binary is absent.
    Raises ValueError for unknown protocol.
    Raises PermissionError if the engagement is not in an authorized state.
    """
    if protocol not in RAPTOR_PROTOCOLS:
        raise ValueError(
            f"unknown raptor protocol {protocol!r}; "
            f"valid: {', '.join(sorted(RAPTOR_PROTOCOLS))}"
        )

    engagement = db.query_one("SELECT status FROM engagements WHERE id=?", [engagement_id])
    if not engagement:
        raise ValueError(f"engagement not found: {engagement_id}")
    if engagement["status"] not in ("active", "authorized", "local-laboratory", "ctf"):
        raise PermissionError(
            f"raptor scan blocked: engagement status is {engagement['status']!r}; "
            "must be active, authorized, local-laboratory, or ctf"
        )

    raptor_bin = get_settings().tools.get("raptor", _RAPTOR_DEFAULT)
    if not shutil.which(raptor_bin):
        raise RuntimeError(
            f"raptor binary not found: install raptor from /home/anon/raptor/ "
            f"(looked for {raptor_bin!r})"
        )

    target_path = str(Path(target_path).resolve())

    execution_id = str(uuid.uuid4())
    db.insert("executions", {
        "id": execution_id, "engagement_id": engagement_id, "project_id": project_id,
        "kind": "raptor.scan", "status": "running", "risk_class": "passive",
        "input": json.dumps({"protocol": protocol, "target_path": target_path,
                              "output_format": output_format, "created_by": created_by},
                             sort_keys=True),
        "output": "{}", "budget": "{}", "idempotency_key": None,
        "lease_owner": "raptor-worker", "lease_expires_at": None,
        "attempt": 1, "error": None,
        "started_at": _now(), "finished_at": None, "created_at": _now(),
    })
    hub.broadcast("raptor.scan.started", {
        "execution_id": execution_id, "protocol": protocol, "target_path": target_path,
    })

    cmd = [raptor_bin, "scan", "-t", protocol, "-p", target_path, "-o", output_format]
    logger.info("raptor: %s", " ".join(cmd))
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        db.execute(
            "UPDATE executions SET status='failed', finished_at=?, error=? WHERE id=?",
            [_now(), "raptor scan timed out after 300s", execution_id],
        )
        hub.broadcast("raptor.scan.done", {"execution_id": execution_id, "status": "failed"})
        return {"execution_id": execution_id, "findings_count": 0, "output_lines": []}

    if proc.returncode != 0:
        stderr_tail = (proc.stderr or "").strip().splitlines()[-10:]
        logger.warning("raptor exited %d: %s", proc.returncode, "\n".join(stderr_tail))

    output_lines: list[str] = []
    findings_count = 0
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        output_lines.append(line)
        try:
            json.loads(line)
            findings_count += 1
        except json.JSONDecodeError:
            pass

    result = {
        "findings_count": findings_count,
        "output_lines": output_lines[:50],
        "exit_code": proc.returncode,
    }
    db.execute(
        "UPDATE executions SET status='done', finished_at=?, output=? WHERE id=?",
        [_now(), json.dumps(result, sort_keys=True), execution_id],
    )
    hub.broadcast("raptor.scan.done", {
        "execution_id": execution_id, "status": "done", "findings_count": findings_count,
    })
    return {"execution_id": execution_id, **result}


def run_full_scan(scan_id: str) -> None:
    scan = db.query_one("SELECT * FROM scans WHERE id=?", [scan_id])
    if not scan:
        return
    db.execute("UPDATE scans SET status='running', started_at=? WHERE id=?", [_now(), scan_id])
    hub.broadcast("scan.status", {"scan_id": scan_id, "status": "running"})
    project_id, target = scan["project_id"], scan["target"]
    try:
        hosts = discover_hosts(target, scan_id)
        assets = probe_hosts(project_id, hosts, scan_id)
        live = [f"{a['scheme']}://{a['host']}:{a['port']}" for a in assets] or \
               [f"https://{h}" for h in hosts]
        found = run_nuclei(project_id, scan_id, scan["task_id"], live)
        stats = {"hosts": len(hosts), "assets": len(assets), "findings": found}
        db.execute("UPDATE scans SET status='done', finished_at=?, stats=? WHERE id=?",
                   [_now(), json.dumps(stats), scan_id])
        hub.broadcast("scan.status", {"scan_id": scan_id, "status": "done", "stats": stats})
    except Exception as exc:  # noqa: BLE001
        _append_log(scan_id, f"[error] {exc}")
        db.execute("UPDATE scans SET status='failed', finished_at=? WHERE id=?", [_now(), scan_id])
        hub.broadcast("scan.status", {"scan_id": scan_id, "status": "failed"})
