"""Central engagement scope and risk-policy evaluation."""
from __future__ import annotations

import fnmatch
import ipaddress
import json
import socket
import urllib.parse
from datetime import datetime, timezone

from .. import db

RISK_ORDER = {"passive": 0, "low-impact": 1, "state-changing": 2,
              "credential-sensitive": 3, "high-volume": 4, "destructive": 5,
              "prohibited": 6}
AUTONOMY_LIMIT = {"guided": -1, "balanced": 1, "autonomous": 4}
AUTHORIZED_STATUSES = {"active", "authorized", "local-laboratory", "ctf"}
BLOCKED_STATUSES = {"authorization-pending", "scope-uncertain", "expired", "out-of-scope", "blocked"}


def _latest_acknowledgment(engagement_id: str) -> dict | None:
    row = db.query_one(
        "SELECT * FROM scope_acknowledgments WHERE engagement_id=? ORDER BY created_at DESC LIMIT 1",
        [engagement_id],
    )
    return db.decode_row(row) if row else None


def _expired(expires_at: str | None) -> bool:
    if not expires_at:
        return False
    try:
        return datetime.fromisoformat(expires_at) <= datetime.now(timezone.utc)
    except ValueError:
        return True


def _matches(host: str, rule: dict) -> bool:
    pattern = rule["pattern"].strip().lower()
    if rule["resource_type"] == "cidr":
        try:
            network = ipaddress.ip_network(pattern, strict=False)
            return any(ipaddress.ip_address(item[4][0]) in network
                       for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM))
        except (ValueError, OSError):
            return False
    return fnmatch.fnmatch(host.lower(), pattern)


def evaluate(engagement_id: str, url: str, method: str = "GET",
             risk_class: str = "low-impact") -> dict:
    engagement = db.query_one("SELECT * FROM engagements WHERE id=?", [engagement_id])
    if not engagement:
        return {"allowed": False, "requires_approval": False, "reason": "inactive engagement"}
    status = engagement["status"]
    if status in BLOCKED_STATUSES or status not in AUTHORIZED_STATUSES:
        return {"allowed": False, "requires_approval": False,
                "reason": f"authorization status is {status}"}
    acknowledgment = _latest_acknowledgment(engagement_id)
    if status != "active":
        if not acknowledgment:
            return {"allowed": False, "requires_approval": False,
                    "reason": "authorization acknowledgment required"}
        if acknowledgment["authorization_status"] != status:
            return {"allowed": False, "requires_approval": False,
                    "reason": "authorization acknowledgment mismatch"}
        if _expired(acknowledgment["expires_at"]):
            return {"allowed": False, "requires_approval": False,
                    "reason": "authorization expired"}
    try:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username:
            raise ValueError
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        return {"allowed": False, "requires_approval": False, "reason": "invalid URL"}

    rules = [db.decode_row(r) for r in db.query(
        "SELECT * FROM scope_rules_v2 WHERE engagement_id=? AND active=1", [engagement_id])]
    matched = [r for r in rules if _matches(parsed.hostname, r)]
    excludes = [r for r in matched if r["effect"] == "exclude"]
    includes = [r for r in matched if r["effect"] == "include"]
    if excludes or not includes:
        return {"allowed": False, "requires_approval": False, "reason": "out of scope"}
    rule = includes[0]
    if rule["ports"] and port not in rule["ports"]:
        return {"allowed": False, "requires_approval": False, "reason": "port not allowed"}
    if rule["methods"] and method.upper() not in {m.upper() for m in rule["methods"]}:
        return {"allowed": False, "requires_approval": False, "reason": "method not allowed"}
    if acknowledgment and acknowledgment["allowed_methods"]:
        allowed_methods = {m.upper() for m in acknowledgment["allowed_methods"]}
        if method.upper() not in allowed_methods:
            return {"allowed": False, "requires_approval": False,
                    "reason": "method not allowed by authorization"}
    if risk_class == "prohibited":
        return {"allowed": False, "requires_approval": False, "reason": "prohibited action"}

    policy_data = json.loads(engagement["policy"] or "{}")
    if acknowledgment:
        policy_data = {**policy_data, "rate_limit_per_minute": acknowledgment["rate_limit_per_minute"],
                       "concurrency_limit": acknowledgment["concurrency_limit"],
                       "allowed_methods": acknowledgment["allowed_methods"]}
    overrides = policy_data.get("action_classes", {})
    decision = overrides.get(risk_class)
    if decision == "deny" or (risk_class == "destructive" and decision != "approve"):
        return {"allowed": False, "requires_approval": False, "reason": "policy denied"}
    automatic = decision == "allow" or RISK_ORDER.get(risk_class, 99) <= AUTONOMY_LIMIT.get(
        engagement["autonomy"], 1)
    return {"allowed": True, "requires_approval": not automatic,
            "reason": "approval required" if not automatic else "policy allowed",
            "matched_rule_id": rule["id"], "resolved_host": parsed.hostname, "port": port,
            "rate_limit_per_minute": policy_data.get("rate_limit_per_minute"),
            "concurrency_limit": policy_data.get("concurrency_limit")}
