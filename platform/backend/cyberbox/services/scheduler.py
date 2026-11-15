"""Scheduler — recurring scans and attack-surface re-checks.

A scheduled_job is a (kind, spec, interval) bound to an engagement for policy. The runner
leases a due job, executes it by kind, records the outcome, and reschedules by interval.
Execution is pull-based: `run_due()` is called by a cron, the app's optional background loop,
or a CLI — so there is no always-on thread that could wedge startup on WSL2.

Supported kinds:
  github_scan     spec: {repo, base?, scope?, fail_on?, source_id?} -> github.scan_repository
  surface_rescan  spec: {project_id?}                               -> surface.snapshot_and_drift
  cve_intel_hunt  spec: {slug, mode?, theme?, repo?, timeout?}       -> cve_intel.run_hunt
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from .. import db
from . import cve_intel, events, github, notify, surface

_KINDS = ("github_scan", "surface_rescan", "cve_intel_hunt")

_LEASE_SECONDS = 300


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def create_job(kind: str, interval_seconds: int, spec: dict | None = None,
               project_id: str | None = None, engagement_id: str | None = None,
               first_run_at: str | None = None) -> dict:
    if interval_seconds < 30:
        raise ValueError("interval_seconds must be >= 30")
    if kind not in _KINDS:
        raise ValueError(f"unknown job kind {kind!r}")
    if kind == "cve_intel_hunt" and not (spec or {}).get("slug"):
        raise ValueError("cve_intel_hunt job missing spec.slug")
    now = _now_dt()
    job_id = str(uuid.uuid4())
    row = {"id": job_id, "project_id": project_id, "engagement_id": engagement_id,
           "kind": kind, "spec": json.dumps(spec or {}), "interval_seconds": interval_seconds,
           "enabled": 1, "next_run_at": first_run_at or _iso(now), "last_run_at": None,
           "last_status": None, "lease_owner": None, "lease_expires_at": None,
           "created_at": _iso(now), "updated_at": _iso(now)}
    db.insert("scheduled_jobs", row)
    return db.decode_row(row)


def list_jobs(enabled: bool | None = None) -> list[dict]:
    sql = "SELECT * FROM scheduled_jobs"
    params: list = []
    if enabled is not None:
        sql += " WHERE enabled=?"
        params.append(1 if enabled else 0)
    sql += " ORDER BY next_run_at"
    return [db.decode_row(r) for r in db.query(sql, params)]


def get_job(job_id: str) -> dict | None:
    row = db.query_one("SELECT * FROM scheduled_jobs WHERE id=?", [job_id])
    return db.decode_row(row) if row else None


def set_enabled(job_id: str, enabled: bool) -> dict | None:
    db.execute("UPDATE scheduled_jobs SET enabled=?, updated_at=? WHERE id=?",
               [1 if enabled else 0, _iso(_now_dt()), job_id])
    return get_job(job_id)


def delete_job(job_id: str) -> None:
    db.execute("DELETE FROM scheduled_jobs WHERE id=?", [job_id])


def due_jobs(now: datetime | None = None) -> list[dict]:
    now = now or _now_dt()
    rows = db.query(
        "SELECT * FROM scheduled_jobs WHERE enabled=1 AND next_run_at<=? "
        "AND (lease_expires_at IS NULL OR lease_expires_at<?) ORDER BY next_run_at",
        [_iso(now), _iso(now)])
    return [db.decode_row(r) for r in rows]


def _execute(job: dict) -> dict:
    spec = job.get("spec") or {}
    if job["kind"] == "github_scan":
        repo = spec.get("repo")
        if not repo:
            raise ValueError("github_scan job missing spec.repo")
        scan = github.scan_repository(
            repo, base=spec.get("base"), scope=spec.get("scope", "full"),
            fail_on=spec.get("fail_on", "high"), trigger="scheduled",
            source_id=spec.get("source_id"))
        return {"scan_id": scan["id"], "exit_code": scan["exit_code"],
                "total": scan["summary"].get("total", 0)}
    if job["kind"] == "surface_rescan":
        project_id = spec.get("project_id") or job.get("project_id")
        if not project_id:
            raise ValueError("surface_rescan job missing project_id")
        drift = surface.snapshot_and_drift(project_id)
        if drift.get("added"):
            notify.send("surface.drift",
                        f"Attack surface changed: {len(drift['added'])} new host(s)",
                        "New: " + ", ".join(drift["added"][:10]), severity="medium")
        return drift
    if job["kind"] == "cve_intel_hunt":
        slug = spec.get("slug")
        if not slug:
            raise ValueError("cve_intel_hunt job missing spec.slug")
        result = cve_intel.run_hunt(
            slug, mode=spec.get("mode", "static"), theme=bool(spec.get("theme")),
            repo=spec.get("repo"), timeout=int(spec.get("timeout", 1800)))
        if result.get("candidates"):
            notify.send(
                "cve_intel.candidates",
                f"cve-intel hunt '{slug}': {result['candidates']} candidate(s)",
                f"mode={result['mode']} · index={result.get('index_path')}",
                severity="medium")
        return result
    raise ValueError(f"unknown job kind {job['kind']!r}")


def run_due(owner: str = "scheduler", now: datetime | None = None) -> list[dict]:
    """Run every due job once. Each is leased so concurrent runners don't double-execute.
    Returns one result record per job attempted."""
    now = now or _now_dt()
    results: list[dict] = []
    for job in due_jobs(now):
        lease_until = _iso(now + timedelta(seconds=_LEASE_SECONDS))
        # Claim the lease atomically: only if still unleased/expired.
        with db._lock:
            cur = db.conn().execute(
                "UPDATE scheduled_jobs SET lease_owner=?, lease_expires_at=? "
                "WHERE id=? AND enabled=1 AND next_run_at<=? "
                "AND (lease_expires_at IS NULL OR lease_expires_at<?)",
                [owner, lease_until, job["id"], _iso(now), _iso(now)])
            db.conn().commit()
            claimed = cur.rowcount == 1
        if not claimed:
            continue
        try:
            output = _execute(job)
            status = "ok"
        except Exception as exc:  # noqa: BLE001 — record failure, keep the scheduler alive
            output = {"error": str(exc)}
            status = "error"
        next_run = _iso(now + timedelta(seconds=job["interval_seconds"]))
        db.execute(
            "UPDATE scheduled_jobs SET last_run_at=?, last_status=?, next_run_at=?, "
            "lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?",
            [_iso(now), status, next_run, _iso(now), job["id"]])
        if job.get("project_id"):
            events.append(job["project_id"], "scheduler.job_ran",
                          {"job_id": job["id"], "kind": job["kind"], "status": status})
        results.append({"job_id": job["id"], "kind": job["kind"], "status": status,
                        "output": output, "next_run_at": next_run})
    return results
