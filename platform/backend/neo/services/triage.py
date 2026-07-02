"""Backlog management: auto-triage, dedup, severity enrichment, retest."""
from __future__ import annotations

from datetime import datetime, timezone

from .. import db
from ..hub import hub
from . import verify

ENRICH_RULES = [
    ("Remote Code Execution", "critical"),
    ("Secrets Exposure", "high"),
    ("Broken Authentication", "high"),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rank(sev: str) -> int:
    return {"critical": 5, "high": 4, "medium": 3, "low": 2, "info": 1, "unknown": 0}.get(sev, 0)


def auto_triage(project_id: str) -> dict:
    triaged = enriched = 0
    for v in db.query("SELECT * FROM vulnerabilities WHERE project_id=? AND status='open'", [project_id]):
        new_sev = v["severity"]
        for cat, sev in ENRICH_RULES:
            if v["category"] == cat and _rank(sev) > _rank(new_sev):
                new_sev = sev
                enriched += 1
        if v["verified"]:
            db.execute("UPDATE vulnerabilities SET status='triaged', severity=? WHERE id=?",
                       [new_sev, v["id"]])
            triaged += 1
        elif new_sev != v["severity"]:
            db.execute("UPDATE vulnerabilities SET severity=? WHERE id=?", [new_sev, v["id"]])
    hub.broadcast("triage.done", {"project_id": project_id, "triaged": triaged, "enriched": enriched})
    return {"triaged": triaged, "enriched": enriched}


def retest(vuln_id: str) -> dict:
    import json
    v = db.query_one("SELECT * FROM vulnerabilities WHERE id=?", [vuln_id])
    if not v:
        return {"error": "not found"}
    template_id = v["template_id"] or ""
    verified, poc, chain = verify.verify_finding(template_id, v["matched_at"] or "", {})
    has_verifier = any(key in template_id for key in verify.VERIFIERS)
    if not verified and has_verifier and v["status"] in ("open", "triaged"):
        db.execute("UPDATE vulnerabilities SET status='fixed', fixed_at=? WHERE id=?", [_now(), vuln_id])
        result = "fixed"
    elif verified and v["status"] == "fixed":
        db.execute("UPDATE vulnerabilities SET status='regressed', fixed_at=NULL, poc=?, request_chain=? WHERE id=?",
                   [poc, json.dumps(chain), vuln_id])
        result = "regressed"
    else:
        db.execute("UPDATE vulnerabilities SET verified=?, poc=?, request_chain=? WHERE id=?",
                   [1 if verified else 0, poc, json.dumps(chain), vuln_id])
        result = "still_present" if verified else "unconfirmed"
    hub.broadcast("vuln.retested", {"id": vuln_id, "result": result})
    return {"result": result, "verified": verified}
