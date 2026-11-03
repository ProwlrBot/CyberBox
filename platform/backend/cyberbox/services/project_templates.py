"""Built-in project templates. Templates configure context; they never authorize targets."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from .. import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


_TEMPLATES = [
    ("bug-bounty-program", "Bug Bounty Program", "bug-bounty"),
    ("web-penetration-test", "Web Penetration Test", "web-application-testing"),
    ("api-security-assessment", "API Security Assessment", "api-security"),
    ("android-assessment", "Android Application Assessment", "mobile-security"),
    ("ios-assessment", "iOS Application Assessment", "mobile-security"),
    ("cloud-configuration-audit", "Cloud Configuration Audit", "cloud-security"),
    ("kubernetes-assessment", "Kubernetes Assessment", "container-kubernetes-security"),
    ("malware-reverse-engineering", "Malware Reverse Engineering", "malware-analysis"),
    ("disk-forensics", "Disk Forensics", "digital-forensics"),
    ("phishing-investigation", "Phishing Investigation", "soc-incident-response"),
    ("osint-case", "OSINT Case", "osint"),
    ("ctf-challenge", "CTF Challenge", "ctf"),
    ("security-laboratory", "Security Laboratory", "security-education"),
]


def _manifest(template_id: str, profile_id: str) -> dict:
    offline = profile_id in {"malware-analysis", "digital-forensics"}
    return {
        "profile_id": profile_id,
        "authorization_status": "authorization-pending",
        "network_mode": "offline" if offline else "restricted",
        "scope": {"targets": [], "exclusions": [], "methods": ["GET", "HEAD"],
                  "rate_limit_per_minute": 30, "concurrency": 2},
        "policy": {"default_deny": True, "destructive_actions": "blocked",
                   "credential_testing": "blocked", "acknowledgment_required": True},
        "folders": ["artifacts", "evidence", "findings", "notes", "reports", "workflows"],
        "template_id": template_id,
    }


def seed() -> None:
    for template_id, name, profile_id in _TEMPLATES:
        row = {"id": template_id, "name": name, "profile_id": profile_id,
               "maturity": "preview", "manifest": json.dumps(
                   _manifest(template_id, profile_id), sort_keys=True),
               "builtin": 1, "created_at": _now()}
        db.upsert("project_templates", row, ["id"],
                  ["name", "profile_id", "maturity", "manifest", "builtin"])


def get(template_id: str) -> dict | None:
    row = db.query_one("SELECT * FROM project_templates WHERE id=?", [template_id])
    return db.decode_row(row) if row else None
