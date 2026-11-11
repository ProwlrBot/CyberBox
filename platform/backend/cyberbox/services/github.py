"""GitHub integration — diff-scoped code scanning (Semgrep/Strix-style) for CyberBox.

Mirrors the Strix CI model so CyberBox drops into a pipeline the same way:
  * diff-scoped scan of a PR (only changed lines) or a full-tree scan
  * exit-code gate: 0 pass, 2 findings at/above the fail_on threshold, 1 error
  * SARIF 2.1.0 output for GitHub code scanning (see services.sarif)
  * an HMAC-verified webhook path that turns a pull_request event into a scan

Security posture (project rules): inbound webhook + scanning is default-on (read-only);
*outbound* posting back to GitHub (PR comments, check-runs) is opt-in and reads its token
from the OS env only — tokens are never stored in the DB. Nothing auto-posts.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .. import db
from . import pr_review, source_revision

_SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}
# Files we never scan as source (binary, vendored, VCS internals).
_SKIP_DIRS = {".git", "node_modules", "vendor", "dist", "build", "__pycache__", ".venv"}
_SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".gz", ".tar",
             ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".lock", ".min.js", ".map"}
_MAX_FILE_BYTES = 1_000_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rule_id(detector: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", detector.lower()).strip("-")
    return f"cyberbox.{slug}"


def _fingerprint(rule_id: str, file: str, line: int, snippet: str) -> str:
    return hashlib.sha256(f"{rule_id}|{file}|{line}|{snippet}".encode()).hexdigest()[:32]


def _normalize(raw: dict, source_id: str | None, revision: str | None) -> dict:
    """Turn a pr_review finding into a code_findings row (no id/scan_id yet)."""
    detector = raw["detector"]
    rule_id = _rule_id(detector)
    file = raw.get("file") or "<unknown>"
    line = int(raw.get("line") or 1)
    snippet = (raw.get("snippet") or "").strip()[:200]
    return {
        "source_id": source_id, "revision": revision, "rule_id": rule_id,
        "detector": detector, "severity": (raw.get("severity") or "medium").lower(),
        "file": file, "line": line,
        "message": raw.get("comment") or f"{detector}: {snippet}",
        "snippet": snippet, "fingerprint": _fingerprint(rule_id, file, line, snippet),
    }


def _scan_tree(repo: str, source_id: str | None, revision: str | None) -> list[dict]:
    """Full-tree scan: apply pr_review's detectors to every source line in the repo."""
    root = Path(repo)
    findings: list[dict] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() in _SKIP_EXT or path.name.endswith(".min.js"):
            continue
        try:
            if path.stat().st_size > _MAX_FILE_BYTES:
                continue
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        rel = str(path.relative_to(root))
        for lineno, added in enumerate(text.splitlines(), start=1):
            for name, severity, rx in pr_review.DETECTORS:
                if rx.search(added):
                    findings.append(_normalize(
                        {"file": rel, "line": lineno, "severity": severity,
                         "detector": name, "snippet": added, "comment": None},
                        source_id, revision))
    return findings


def _scan_diff(repo: str, base: str | None, source_id: str | None,
               revision: str | None) -> list[dict]:
    """Diff-scoped scan: only lines added relative to `base` (pr_review.review_diff)."""
    raw = pr_review.review_diff(repo, base)
    if raw and isinstance(raw[0], dict) and raw[0].get("error"):
        raise ValueError(raw[0]["error"])
    return [_normalize(r, source_id, revision) for r in raw]


def _exit_code(findings: list[dict], fail_on: str) -> int:
    threshold = _SEVERITY_RANK.get((fail_on or "high").lower(), 3)
    if any(_SEVERITY_RANK.get(f["severity"], 2) >= threshold for f in findings):
        return 2
    return 0


def scan_repository(repo: str, base: str | None = None, scope: str = "diff",
                    fail_on: str = "high", pr_number: int | None = None,
                    trigger: str = "manual", source_id: str | None = None,
                    revision: str | None = None) -> dict:
    """Scan a local repo checkout and persist a github_scan + its code_findings.

    scope='diff' scans only lines added since `base` (PR gate); scope='full' scans the tree.
    Returns the scan record including exit_code (0 pass / 2 findings>=fail_on / 1 error) and a
    severity summary — the same contract a CI step gates on.
    """
    scan_id = str(uuid.uuid4())
    now = _now()
    scan = {"id": scan_id, "source_id": source_id, "execution_id": None, "repo": repo,
            "revision": revision, "base_revision": base, "pr_number": pr_number,
            "trigger": trigger, "scope": scope, "status": "running", "fail_on": fail_on,
            "exit_code": None, "summary": "{}", "created_at": now, "finished_at": None}
    db.insert("github_scans", scan)
    try:
        if scope == "full":
            findings = _scan_tree(repo, source_id, revision)
        else:
            findings = _scan_diff(repo, base, source_id, revision)
    except ValueError as exc:
        db.execute("UPDATE github_scans SET status='failed', exit_code=1, summary=?, "
                   "finished_at=? WHERE id=?", [json.dumps({"error": str(exc)}), _now(), scan_id])
        raise
    seen: set[str] = set()
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings:
        if f["fingerprint"] in seen:
            continue
        seen.add(f["fingerprint"])
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1
        db.insert("code_findings", {
            "id": str(uuid.uuid4()), "scan_id": scan_id, "source_id": f["source_id"],
            "revision": f["revision"], "rule_id": f["rule_id"], "detector": f["detector"],
            "severity": f["severity"], "file": f["file"], "line": f["line"],
            "message": f["message"], "snippet": f["snippet"], "fingerprint": f["fingerprint"],
            "status": "open", "created_at": _now()})
    exit_code = _exit_code([{"severity": s} for s, n in counts.items() for _ in range(n)], fail_on)
    summary = {"counts": counts, "total": sum(counts.values()), "fail_on": fail_on}
    db.execute("UPDATE github_scans SET status='completed', exit_code=?, summary=?, finished_at=? "
               "WHERE id=?", [exit_code, json.dumps(summary), _now(), scan_id])
    return get_scan(scan_id)


def get_scan(scan_id: str) -> dict | None:
    row = db.query_one("SELECT * FROM github_scans WHERE id=?", [scan_id])
    if not row:
        return None
    scan = db.decode_row(row)
    scan["findings"] = [db.decode_row(r) for r in db.query(
        "SELECT * FROM code_findings WHERE scan_id=? ORDER BY "
        "CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, file",
        [scan_id])]
    return scan


def list_scans(repo: str | None = None, limit: int = 50) -> list[dict]:
    sql = "SELECT * FROM github_scans"
    params: list = []
    if repo:
        sql += " WHERE repo=?"
        params.append(repo)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    return [db.decode_row(r) for r in db.query(sql, params)]


# ---------------------------------------------------------------------------
# webhook
# ---------------------------------------------------------------------------
def verify_signature(secret: str | None, body: bytes, signature_header: str | None) -> bool:
    """Verify a GitHub webhook HMAC (X-Hub-Signature-256: sha256=...). Constant-time."""
    if not secret or not signature_header:
        return False
    if not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


def handle_pull_request_event(payload: dict, local_path: str | None = None) -> dict:
    """Parse a pull_request webhook into a scan request. If a local checkout is available
    (local_path, or a registered source's metadata.clone_path), scan it diff-scoped against
    the PR base immediately; otherwise record a queued scan for a runner/CLI to pick up."""
    repo = payload.get("repository", {}).get("full_name") or "<unknown>"
    pr = payload.get("pull_request", {})
    pr_number = payload.get("number") or pr.get("number")
    head_sha = pr.get("head", {}).get("sha")
    base_ref = pr.get("base", {}).get("ref")
    source = db.query_one("SELECT * FROM sources WHERE kind='github' AND identifier=?", [repo])
    source_id = source["id"] if source else None
    clone_path = local_path
    if not clone_path and source:
        meta = db.decode_row(source).get("metadata") or {}
        clone_path = meta.get("clone_path")
    if clone_path and Path(clone_path).exists():
        base = f"origin/{base_ref}" if base_ref else None
        return scan_repository(clone_path, base=base, scope="diff", pr_number=pr_number,
                               trigger="webhook", source_id=source_id, revision=head_sha)
    # No local checkout — queue it (a runner / `cyberbox github scan` resolves the repo).
    scan_id = str(uuid.uuid4())
    db.insert("github_scans", {"id": scan_id, "source_id": source_id, "execution_id": None,
              "repo": repo, "revision": head_sha, "base_revision": base_ref, "pr_number": pr_number,
              "trigger": "webhook", "scope": "diff", "status": "queued", "fail_on": "high",
              "exit_code": None, "summary": "{}", "created_at": _now(), "finished_at": None})
    return get_scan(scan_id)


# ---------------------------------------------------------------------------
# outbound (opt-in, token from env only, never auto-posts)
# ---------------------------------------------------------------------------
def format_pr_comment(scan: dict) -> str:
    """Markdown summary suitable for a PR comment / check-run output."""
    counts = (scan.get("summary") or {}).get("counts", {})
    total = (scan.get("summary") or {}).get("total", 0)
    verdict = "❌ failed" if scan.get("exit_code") == 2 else "✅ passed"
    lines = [f"### CyberBox security scan — {verdict}",
             f"`{scan['repo']}`" + (f" PR #{scan['pr_number']}" if scan.get("pr_number") else ""),
             "",
             f"**{total}** finding(s): "
             + ", ".join(f"{n} {s}" for s, n in counts.items() if n) or "none",
             ""]
    for f in scan.get("findings", [])[:25]:
        lines.append(f"- **{f['severity'].upper()}** `{f['file']}:{f['line']}` — {f['detector']}")
    if len(scan.get("findings", [])) > 25:
        lines.append(f"- …and {len(scan['findings']) - 25} more")
    return "\n".join(lines)


def post_results(scan_id: str, token_env: str = "GITHUB_TOKEN", confirm: bool = False) -> dict:
    """Post scan results back to the PR. Opt-in: requires confirm=True AND the token present
    in the named OS env var. Default (confirm=False) is a dry run that returns the payload
    without any outbound request, honoring the default-read-only posture."""
    scan = get_scan(scan_id)
    if not scan:
        raise ValueError("scan not found")
    body = format_pr_comment(scan)
    token = os.environ.get(token_env)
    if not confirm:
        return {"posted": False, "dry_run": True, "reason": "confirm=False (default)",
                "token_env": token_env, "token_present": bool(token), "body": body}
    if not token:
        return {"posted": False, "dry_run": False,
                "reason": f"no token in ${token_env}", "body": body}
    if not scan.get("pr_number"):
        return {"posted": False, "reason": "scan has no pr_number", "body": body}
    # Real POST deferred to a thin HTTP layer the operator enables; kept out of the default
    # path so a scan can never silently reach out. Returns the prepared request for that layer.
    return {"posted": False, "prepared": True,
            "endpoint": f"https://api.github.com/repos/{scan['repo']}/issues/{scan['pr_number']}/comments",
            "body": body, "token_env": token_env}
