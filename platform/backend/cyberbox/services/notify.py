"""Notification channels — Discord / ntfy / generic webhook / JSONL.

Mirrors the cve-intel autonomous-hunt notification model so CyberBox's scheduler and
code-scan gate can alert the same way. Design rules:

  * Secrets never touch the DB. A channel stores `url_env` / `secret_env` — the NAMES of OS
    env vars the service reads at send time (the same pattern cve-intel uses with its
    CVE_INTEL_* GitHub Actions secrets). Non-secret config (ntfy topic, jsonl path, a
    min-severity filter) lives in `config`.
  * Sending is best-effort and never raises: a failed notification must not break a scan or a
    scheduled job. Every attempt is recorded in notifications_log.
  * Outbound only to operator-configured channels — nothing is sent unless a channel exists
    and its env var is populated.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

from .. import db

_SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4, "info": 0}
_TIMEOUT = 6


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_channel(kind: str, name: str, url_env: str | None = None,
                   secret_env: str | None = None, config: dict | None = None) -> dict:
    if kind not in ("discord", "ntfy", "webhook", "jsonl"):
        raise ValueError(f"unknown channel kind {kind!r}")
    cid = str(uuid.uuid4())
    row = {"id": cid, "kind": kind, "name": name, "url_env": url_env, "secret_env": secret_env,
           "config": json.dumps(config or {}), "enabled": 1, "created_at": _now()}
    db.insert("notification_channels", row)
    return db.decode_row(row)


def list_channels() -> list[dict]:
    rows = [db.decode_row(r) for r in db.query(
        "SELECT * FROM notification_channels ORDER BY created_at")]
    # Surface whether the referenced env vars are actually populated (no values leaked).
    for r in rows:
        r["url_configured"] = bool(r.get("url_env") and os.environ.get(r["url_env"]))
        r["secret_configured"] = bool(r.get("secret_env") and os.environ.get(r["secret_env"]))
    return rows


def delete_channel(channel_id: str) -> None:
    db.execute("DELETE FROM notification_channels WHERE id=?", [channel_id])


def set_enabled(channel_id: str, enabled: bool) -> None:
    db.execute("UPDATE notification_channels SET enabled=? WHERE id=?",
               [1 if enabled else 0, channel_id])


def _post_json(url: str, payload: dict, headers: dict | None = None) -> None:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json", **(headers or {})})
    urllib.request.urlopen(req, timeout=_TIMEOUT).read()  # noqa: S310 — operator-configured URL


def _deliver(channel: dict, event: str, title: str, body: str, severity: str) -> tuple[str, str]:
    kind = channel["kind"]
    cfg = channel.get("config") or {}
    if kind == "jsonl":
        path = cfg.get("path") or os.path.expanduser("~/.cyberbox/notifications.jsonl")
        with open(path, "a") as fh:
            fh.write(json.dumps({"event": event, "title": title, "body": body,
                                 "severity": severity, "at": _now()}) + "\n")
        return "sent", path
    url = os.environ.get(channel["url_env"]) if channel.get("url_env") else None
    if not url:
        return "skipped", f"env ${channel.get('url_env')} not set"
    if kind == "discord":
        _post_json(url, {"content": f"**{title}**\n{body}"})
        return "sent", "discord"
    if kind == "ntfy":
        topic = cfg.get("topic", "cyberbox")
        req = urllib.request.Request(f"{url.rstrip('/')}/{topic}", data=body.encode(),
                                     method="POST", headers={"Title": title, "Priority": "default"})
        urllib.request.urlopen(req, timeout=_TIMEOUT).read()  # noqa: S310
        return "sent", f"ntfy:{topic}"
    if kind == "webhook":
        payload = {"event": event, "title": title, "body": body, "severity": severity, "at": _now()}
        headers = {}
        secret = os.environ.get(channel["secret_env"]) if channel.get("secret_env") else None
        if secret:
            sig = hmac.new(secret.encode(), json.dumps(payload).encode(), hashlib.sha256).hexdigest()
            headers["X-CyberBox-Signature-256"] = f"sha256={sig}"
        _post_json(url, payload, headers)
        return "sent", "webhook"
    return "error", f"unknown kind {kind}"


def send(event: str, title: str, body: str, severity: str = "info") -> list[dict]:
    """Fan an event out to all enabled channels. Best-effort; records every attempt."""
    results: list[dict] = []
    threshold_sev = _SEVERITY_RANK.get(severity, 0)
    for channel in [db.decode_row(r) for r in db.query(
            "SELECT * FROM notification_channels WHERE enabled=1")]:
        cfg = channel.get("config") or {}
        min_sev = _SEVERITY_RANK.get(cfg.get("min_severity", "info"), 0)
        if threshold_sev < min_sev:
            status, detail = "skipped", f"below min_severity {cfg.get('min_severity')}"
        else:
            try:
                status, detail = _deliver(channel, event, title, body, severity)
            except (urllib.error.URLError, OSError, ValueError) as exc:
                status, detail = "error", str(exc)[:200]
        db.insert("notifications_log", {
            "id": str(uuid.uuid4()), "channel_id": channel["id"], "event": event,
            "status": status, "detail": detail, "created_at": _now()})
        results.append({"channel": channel["name"], "kind": channel["kind"],
                        "status": status, "detail": detail})
    return results


def recent_log(limit: int = 50) -> list[dict]:
    return [db.decode_row(r) for r in db.query(
        "SELECT * FROM notifications_log ORDER BY created_at DESC LIMIT ?", [limit])]
