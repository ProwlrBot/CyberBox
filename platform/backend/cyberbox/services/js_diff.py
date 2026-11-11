"""JS full-diff hunting — snapshot JavaScript bundles over time and diff them.

The bug-bounty payoff: when a target ships a new frontend build, the diff of its JS bundles often
reveals *fresh attack surface* before anyone else looks — new API endpoints, new request params,
and sometimes a secret that slipped into the bundle. This service fetches a JS URL, stores each
distinct revision (keyed by content hash), and produces a full textual diff between two revisions
plus a structured list of what was ADDED: endpoints, params and secret-shaped tokens.

Safety: the fetch is a passive GET with the same SSRF guard as the fingerprint probe (cloud-metadata
is hard-blocked; the caller scope-gates the target). Extraction is pure regex over the body — no
evaluation of the JS. Secret matches are reported as leads to verify, never as confirmed credentials.
"""
from __future__ import annotations

import difflib
import hashlib
import ipaddress
import json
import re
import socket
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

from .. import db
from .fingerprint import ProbeBlocked, _assert_not_metadata  # reuse the SSRF guard

_UA = "CyberBox-JSDiff/1.0"
_TIMEOUT = 12
_MAX_BYTES = 4 * 1024 * 1024  # JS bundles are bigger than fingerprint pages


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Extraction ─────────────────────────────────────────────────────────────────────
# Endpoint-ish strings: absolute paths and api routes inside quotes, and fetch/axios/url targets.
_ENDPOINT_RES = [
    re.compile(r"""['"`](/(?:api|v\d|graphql|rest|internal|admin|user|account|oauth|auth)[A-Za-z0-9_\-./{}:]*)['"`]"""),
    re.compile(r"""['"`](/[A-Za-z0-9_\-]+/[A-Za-z0-9_\-./{}:]{2,})['"`]"""),
    re.compile(r"""\b(?:fetch|axios\.(?:get|post|put|delete|patch)|\.open)\(\s*['"`]([^'"`]+)['"`]"""),
    re.compile(r"""['"`](https?://[A-Za-z0-9.\-]+/[A-Za-z0-9_\-./{}:?=&%]+)['"`]"""),
]
# Secret-shaped tokens. Reported as leads to verify — never asserted as live credentials.
_SECRET_RES = [
    ("aws_access_key", re.compile(r"\b(AKIA[0-9A-Z]{16})\b")),
    ("google_api_key", re.compile(r"\b(AIza[0-9A-Za-z_\-]{35})\b")),
    ("slack_token", re.compile(r"\b(xox[baprs]-[0-9A-Za-z\-]{10,})\b")),
    ("stripe_key", re.compile(r"\b((?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{16,})\b")),
    ("github_token", re.compile(r"\b(gh[pousr]_[0-9A-Za-z]{30,})\b")),
    ("jwt", re.compile(r"\b(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})\b")),
    ("private_key", re.compile(r"(-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----)")),
    ("generic_secret", re.compile(r"""['"]?(?:api[_-]?key|secret|token|passwd|password|access[_-]?token)['"]?\s*[:=]\s*['"]([A-Za-z0-9_\-]{12,})['"]""", re.I)),
]


def extract_endpoints(js: str) -> list[str]:
    found: set[str] = set()
    for rx in _ENDPOINT_RES:
        for m in rx.findall(js):
            val = (m if isinstance(m, str) else m[0]).strip()
            if 1 < len(val) <= 200 and not val.startswith("//"):
                found.add(val)
    return sorted(found)


def extract_secrets(js: str) -> list[dict]:
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for kind, rx in _SECRET_RES:
        for m in rx.findall(js):
            val = m if isinstance(m, str) else m[0]
            key = (kind, val)
            if key in seen:
                continue
            seen.add(key)
            # Redact the middle so the lead is actionable without copy-pasting a live secret.
            shown = val if len(val) <= 12 else f"{val[:6]}…{val[-4:]}"
            out.append({"kind": kind, "match": shown})
    return out


# ── Fetch + snapshot ─────────────────────────────────────────────────────────────

def fetch_js(url: str) -> tuple[int, str]:
    """GET a JS URL with the SSRF guard. Returns (status, body_text). Redirects are not followed."""
    from urllib.parse import urlsplit
    sp = urlsplit(url)
    if sp.scheme not in ("http", "https") or not sp.hostname:
        raise ProbeBlocked("invalid JS URL")
    _assert_not_metadata(sp.hostname)

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_a, **_k):
            return None

    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "*/*"}, method="GET")
    try:
        with opener.open(req, timeout=_TIMEOUT) as resp:
            raw = resp.read(_MAX_BYTES)
            return resp.status, raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, ""
    except (urllib.error.URLError, socket.timeout, OSError, ValueError):
        return 0, ""


def snapshot(project_id: str, url: str, content: str | None = None) -> dict:
    """Fetch (or accept) the JS at `url` and store it as a revision if its content changed.

    Returns {url, changed, status, hash, prev_hash, size, endpoints, secrets}. A re-fetch of an
    unchanged bundle is a no-op (changed=False) — the UNIQUE(project,url,hash) index enforces it."""
    status = 200
    if content is None:
        status, content = fetch_js(url)
        if not status or not content:
            return {"url": url, "changed": False, "status": status, "error": "empty or unreachable"}
    digest = hashlib.sha256(content.encode("utf-8", "replace")).hexdigest()
    prev = db.query_one(
        "SELECT content_hash FROM js_snapshots WHERE project_id=? AND url=? ORDER BY fetched_at DESC LIMIT 1",
        [project_id, url])
    prev_hash = prev["content_hash"] if prev else None
    endpoints = extract_endpoints(content)
    secrets = extract_secrets(content)
    if prev_hash == digest:
        return {"url": url, "changed": False, "status": status, "hash": digest, "prev_hash": prev_hash,
                "size": len(content), "endpoints": len(endpoints), "secrets": len(secrets)}
    db.execute(
        "INSERT OR IGNORE INTO js_snapshots (id, project_id, url, content_hash, content, size, "
        "endpoints, secrets, fetched_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [str(uuid.uuid4()), project_id, url, digest, content, len(content),
         json.dumps(endpoints), json.dumps(secrets), _now()])
    return {"url": url, "changed": True, "status": status, "hash": digest, "prev_hash": prev_hash,
            "size": len(content), "endpoints": len(endpoints), "secrets": len(secrets)}


# ── Reads + diff ─────────────────────────────────────────────────────────────────

def list_tracked(project_id: str) -> list[dict]:
    """One row per tracked JS url: revision count, latest hash/time, latest endpoint/secret counts."""
    rows = db.query(
        "SELECT url, COUNT(*) AS revisions, MAX(fetched_at) AS last_seen FROM js_snapshots "
        "WHERE project_id=? GROUP BY url ORDER BY last_seen DESC", [project_id])
    out = []
    for r in rows:
        latest = db.query_one(
            "SELECT content_hash, size, endpoints, secrets, fetched_at FROM js_snapshots "
            "WHERE project_id=? AND url=? ORDER BY fetched_at DESC LIMIT 1", [project_id, r["url"]])
        out.append({
            "url": r["url"], "revisions": r["revisions"], "last_seen": r["last_seen"],
            "hash": latest["content_hash"][:12], "size": latest["size"],
            "endpoint_count": len(json.loads(latest["endpoints"] or "[]")),
            "secret_count": len(json.loads(latest["secrets"] or "[]")),
        })
    return out


def _snap(project_id: str, url: str, which: str) -> dict | None:
    order = "ASC" if which == "first" else "DESC"
    return db.query_one(
        f"SELECT * FROM js_snapshots WHERE project_id=? AND url=? ORDER BY fetched_at {order} LIMIT 1",
        [project_id, url])


def diff(project_id: str, url: str, from_hash: str | None = None, to_hash: str | None = None) -> dict:
    """Full diff between two revisions of a JS url (defaults: previous vs latest).

    Returns the unified diff plus ADDED/REMOVED endpoints and ADDED secret leads — the new attack
    surface a deploy introduced. Raises ValueError if the url has fewer than two revisions."""
    revs = db.query(
        "SELECT content_hash, content, endpoints, secrets, fetched_at FROM js_snapshots "
        "WHERE project_id=? AND url=? ORDER BY fetched_at", [project_id, url])
    if len(revs) < 2:
        raise ValueError("need at least two revisions to diff")
    by_hash = {r["content_hash"]: r for r in revs}
    old = by_hash.get(from_hash) if from_hash else revs[-2]
    new = by_hash.get(to_hash) if to_hash else revs[-1]
    if old is None or new is None:
        raise ValueError("unknown revision hash")
    old_eps = set(json.loads(old["endpoints"] or "[]"))
    new_eps = set(json.loads(new["endpoints"] or "[]"))
    old_secrets = {(s["kind"], s["match"]) for s in json.loads(old["secrets"] or "[]")}
    new_secrets = json.loads(new["secrets"] or "[]")
    unified = list(difflib.unified_diff(
        old["content"].splitlines(), new["content"].splitlines(),
        fromfile=f"{url}@{old['content_hash'][:8]}", tofile=f"{url}@{new['content_hash'][:8]}",
        lineterm="", n=2))
    MAX_DIFF = 4000  # keep the response bounded for a minified megabyte-bundle
    truncated = len(unified) > MAX_DIFF
    return {
        "url": url,
        "from": {"hash": old["content_hash"][:12], "fetched_at": old["fetched_at"]},
        "to": {"hash": new["content_hash"][:12], "fetched_at": new["fetched_at"]},
        "added_endpoints": sorted(new_eps - old_eps),
        "removed_endpoints": sorted(old_eps - new_eps),
        "added_secrets": [s for s in new_secrets if (s["kind"], s["match"]) not in old_secrets],
        "unified_diff": unified[:MAX_DIFF],
        "unified_diff_truncated": truncated,
    }
