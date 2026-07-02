"""Analytics computed from the live DB — no hard-coded values."""
from __future__ import annotations

from datetime import datetime, timezone

from .. import db

SEVERITY_WEIGHT = {"critical": 40, "high": 20, "medium": 8, "low": 3, "info": 0, "unknown": 5}


def severity_breakdown(project_id: str) -> dict:
    rows = db.query(
        "SELECT severity, COUNT(*) c FROM vulnerabilities "
        "WHERE project_id=? AND status IN ('open','triaged','regressed') GROUP BY severity",
        [project_id])
    out = {s: 0 for s in ("critical", "high", "medium", "low", "info", "unknown")}
    for r in rows:
        out[r["severity"]] = r["c"]
    return out


def security_score(project_id: str) -> dict:
    breakdown = severity_breakdown(project_id)
    penalty = sum(SEVERITY_WEIGHT.get(s, 0) * c for s, c in breakdown.items())
    score = max(0, 100 - min(100, penalty))
    return {"score": score, "needs_attention": score < 70,
            "breakdown": breakdown, "total_active": sum(breakdown.values())}


def remediation_efficiency(project_id: str) -> dict:
    out = {}
    for sev in ("critical", "high", "medium", "low"):
        fixed = db.query(
            "SELECT detected_at, fixed_at, sla_due FROM vulnerabilities "
            "WHERE project_id=? AND severity=? AND status='fixed' AND fixed_at IS NOT NULL",
            [project_id, sev])
        if not fixed:
            out[sev] = {"fixed": 0, "on_time_pct": None, "avg_days": None}
            continue
        on_time, total_days = 0, 0.0
        for v in fixed:
            det = datetime.fromisoformat(v["detected_at"])
            fix = datetime.fromisoformat(v["fixed_at"])
            total_days += (fix - det).total_seconds() / 86400
            if v["sla_due"] and fix <= datetime.fromisoformat(v["sla_due"]):
                on_time += 1
        out[sev] = {"fixed": len(fixed), "on_time_pct": round(100 * on_time / len(fixed)),
                    "avg_days": round(total_days / len(fixed), 1)}
    return out


def regression_efficiency(project_id: str) -> dict:
    reappeared = db.query_one(
        "SELECT COUNT(*) c FROM vulnerabilities WHERE project_id=? AND status='regressed'",
        [project_id])["c"]
    fixed = db.query_one(
        "SELECT COUNT(*) c FROM vulnerabilities WHERE project_id=? AND status='fixed'",
        [project_id])["c"]
    return {"reappeared": reappeared, "fixed": fixed,
            "regression_rate": round(100 * reappeared / fixed) if fixed else 0}


def newest_detections(project_id: str, limit: int = 10) -> list[dict]:
    return db.query(
        "SELECT name, severity, cve, description, host, detected_at FROM vulnerabilities "
        "WHERE project_id=? ORDER BY detected_at DESC LIMIT ?", [project_id, limit])


def assets_breakdown(project_id: str) -> dict:
    total = db.query_one("SELECT COUNT(*) c FROM assets WHERE project_id=?", [project_id])["c"]
    tech_set: set[str] = set()
    for t in db.query("SELECT technologies FROM assets WHERE project_id=?", [project_id]):
        try:
            tech_set.update(__import__("json").loads(t["technologies"]))
        except Exception:  # noqa: BLE001
            pass
    services = db.query_one(
        "SELECT COUNT(DISTINCT service) c FROM assets WHERE project_id=?", [project_id])["c"]
    affected = db.query_one(
        "SELECT COUNT(DISTINCT asset_id) c FROM vulnerabilities "
        "WHERE project_id=? AND asset_id IS NOT NULL AND status IN ('open','triaged','regressed')",
        [project_id])["c"]
    return {"total_assets": total, "services": services,
            "technologies": len(tech_set), "affected_services": affected}


def category_breakdown(project_id: str) -> list[dict]:
    return db.query(
        "SELECT category, COUNT(*) c FROM vulnerabilities "
        "WHERE project_id=? AND status IN ('open','triaged','regressed') "
        "GROUP BY category ORDER BY c DESC", [project_id])


def timeseries(project_id: str) -> list[dict]:
    return db.query(
        "SELECT substr(detected_at,1,10) day, severity, COUNT(*) c FROM vulnerabilities "
        "WHERE project_id=? GROUP BY day, severity ORDER BY day", [project_id])
