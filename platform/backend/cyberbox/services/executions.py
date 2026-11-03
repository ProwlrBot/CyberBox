"""Durable execution records and background scan recovery."""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timedelta, timezone

from .. import db
from . import events, scanner


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create(project_id: str, kind: str, payload: dict, engagement_id: str | None = None,
           risk_class: str = "passive", budget: dict | None = None,
           idempotency_key: str | None = None) -> dict:
    if idempotency_key:
        existing = db.query_one(
            "SELECT * FROM executions WHERE project_id=? AND idempotency_key=?",
            [project_id, idempotency_key],
        )
        if existing:
            return db.decode_row(existing)
    row = {
        "id": str(uuid.uuid4()), "engagement_id": engagement_id, "project_id": project_id,
        "kind": kind, "status": "queued", "risk_class": risk_class,
        "input": json.dumps(payload, sort_keys=True), "output": "{}",
        "budget": json.dumps(budget or {}, sort_keys=True), "idempotency_key": idempotency_key,
        "lease_owner": None, "lease_expires_at": None, "attempt": 0, "error": None,
        "started_at": None, "finished_at": None, "created_at": _now(),
    }
    db.insert("executions", row)
    events.append(project_id, "execution.queued", {"execution_id": row["id"], "kind": kind}, row["id"])
    return db.decode_row(row)


def transition(execution_id: str, status: str, output: dict | None = None,
               error: str | None = None) -> dict:
    current = db.query_one("SELECT * FROM executions WHERE id=?", [execution_id])
    if not current:
        raise ValueError("execution not found")
    fields = ["status=?", "error=?"]
    values: list = [status, error]
    if output is not None:
        fields.append("output=?")
        values.append(json.dumps(output, sort_keys=True))
    if status == "running":
        fields.extend(["started_at=COALESCE(started_at, ?)", "attempt=attempt+1"])
        values.append(_now())
    if status in ("done", "failed", "cancelled"):
        fields.extend(["finished_at=?", "lease_owner=NULL", "lease_expires_at=NULL"])
        values.append(_now())
    values.append(execution_id)
    db.execute(f"UPDATE executions SET {', '.join(fields)} WHERE id=?", values)
    events.append(current["project_id"], f"execution.{status}",
                  {"execution_id": execution_id, "error": error}, execution_id)
    return db.decode_row(db.query_one("SELECT * FROM executions WHERE id=?", [execution_id]) or current)


def _run_scan(execution_id: str) -> None:
    execution = db.query_one("SELECT * FROM executions WHERE id=?", [execution_id])
    if not execution or execution["status"] not in ("queued", "running"):
        return
    payload = json.loads(execution["input"])
    scan_id = payload["scan_id"]
    lease_until = (datetime.now(timezone.utc) + timedelta(minutes=35)).isoformat()
    db.execute("UPDATE executions SET lease_owner=?, lease_expires_at=? WHERE id=?",
               ["local-scan-worker", lease_until, execution_id])
    transition(execution_id, "running")
    scanner.run_full_scan(scan_id)
    scan = db.query_one("SELECT * FROM scans WHERE id=?", [scan_id])
    if scan and scan["status"] == "done":
        transition(execution_id, "done", {"scan_id": scan_id, "stats": json.loads(scan["stats"])})
    else:
        transition(execution_id, "failed", {"scan_id": scan_id},
                   (scan or {}).get("log", "scan did not complete")[-2000:])


def _run_wordfence(execution_id: str) -> None:
    execution = db.query_one("SELECT * FROM executions WHERE id=?", [execution_id])
    if not execution or execution["status"] not in ("queued", "running"):
        return
    from . import wordfence

    payload = json.loads(execution["input"])
    transition(execution_id, "running")
    try:
        result = wordfence.run(payload["slug"], payload["mode"], execution_id)
        if result["exit_code"] == 0:
            transition(execution_id, "done", result)
        else:
            transition(execution_id, "failed", result, result["output"][-1] if result["output"] else "workflow failed")
    except Exception as exc:  # noqa: BLE001 - execution failures are persisted, not leaked
        transition(execution_id, "failed", error=str(exc)[:2000])


def dispatch(execution_id: str) -> None:
    execution = db.query_one("SELECT * FROM executions WHERE id=?", [execution_id])
    if not execution:
        raise ValueError("execution not found")
    if execution["kind"] == "scan.full":
        worker = _run_scan
    elif execution["kind"] == "wordfence.local":
        worker = _run_wordfence
    else:
        return
    threading.Thread(target=worker, args=(execution_id,), daemon=True,
                     name=f"cyberbox-{execution_id[:8]}").start()


def recover() -> int:
    rows = db.query("SELECT id FROM executions WHERE kind IN ('scan.full','wordfence.local') AND status IN ('queued','running')")
    for row in rows:
        if db.query_one("SELECT status FROM executions WHERE id=?", [row["id"]])["status"] == "running":
            db.execute("UPDATE executions SET status='queued', lease_owner=NULL, lease_expires_at=NULL WHERE id=?",
                       [row["id"]])
        dispatch(row["id"])
    return len(rows)
