"""Remediation — the detect→remediate loop (BugBunny-parity "fix delivery").

For each code_finding from a github scan, produce a deterministic remediation: human
guidance, a CWE id, and — where a safe single-line transform exists — a suggested fixed
line plus a GitHub "suggestion" block. From those we build a unified-diff patch for the
scan.

Safety: this service is SUGGEST-ONLY. It never writes to the scanned repo and never
opens a PR by itself. The patch is an artifact the operator reviews and applies; outbound
PR delivery stays behind github.post_results' opt-in/dry-run/token-in-env guardrail. Line
transforms are conservative regex rewrites (TLS flags, yaml.load, secret→env lookup) —
never an LLM guess — so a suggestion is either deterministically safe or omitted.
"""
from __future__ import annotations

import difflib
import re
from pathlib import Path

from .. import db
from . import github as github_svc

# Per-detector remediation. `transform` (optional) maps an offending line to a safer one,
# returning None when no safe deterministic rewrite applies (guidance only).
_SECRET_ASSIGN = re.compile(
    r"""^(?P<indent>\s*)(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?P<op>[=:])\s*['"][^'"]+['"](?P<tail>.*)$""")


def _to_env_lookup(line: str) -> str | None:
    """`API_KEY = "literal"` -> `API_KEY = os.environ["API_KEY"]` (Python-ish, best effort)."""
    m = _SECRET_ASSIGN.match(line)
    if not m:
        return None
    name = m.group("name")
    env_name = name.upper()
    return f'{m.group("indent")}{name} {m.group("op")} os.environ["{env_name}"]{m.group("tail")}'


def _fix_tls(line: str) -> str | None:
    new = line
    new = re.sub(r"verify\s*=\s*False", "verify=True", new)
    new = re.sub(r"rejectUnauthorized\s*:\s*false", "rejectUnauthorized: true", new)
    new = re.sub(r"InsecureSkipVerify\s*:\s*true", "InsecureSkipVerify: false", new)
    return new if new != line else None


def _fix_yaml_load(line: str) -> str | None:
    new = re.sub(r"yaml\.load\(", "yaml.safe_load(", line)
    return new if new != line else None


_REMEDIATIONS: dict[str, dict] = {
    "Hardcoded AWS access key": {
        "cwe": "CWE-798", "transform": _to_env_lookup,
        "guidance": "Remove the literal credential. Load it from the environment or a secrets "
                    "manager and rotate the exposed key immediately."},
    "Hardcoded private key": {
        "cwe": "CWE-798", "transform": None,
        "guidance": "Never commit private keys. Remove it, rotate the key pair, and load the key "
                    "from a secrets manager or a mounted file outside version control."},
    "Hardcoded generic secret": {
        "cwe": "CWE-798", "transform": _to_env_lookup,
        "guidance": "Move the secret to an environment variable or secrets manager and rotate it."},
    "Use of eval()": {
        "cwe": "CWE-95", "transform": None,
        "guidance": "Avoid eval on dynamic input. Use ast.literal_eval for data, json.loads for "
                    "JSON, or an explicit dispatch table for behavior."},
    "Shell injection sink": {
        "cwe": "CWE-78", "transform": None,
        "guidance": "Pass an argument list with shell=False instead of a shell string; if a shell "
                    "is unavoidable, shlex.quote every interpolated value."},
    "SQL string concatenation": {
        "cwe": "CWE-89", "transform": None,
        "guidance": "Use a parameterized query (placeholders + bound params); never concatenate "
                    "user input into SQL."},
    "Disabled TLS verification": {
        "cwe": "CWE-295", "transform": _fix_tls,
        "guidance": "Re-enable certificate verification. If a custom CA is needed, pass its bundle "
                    "rather than disabling verification."},
    "Insecure deserialization": {
        "cwe": "CWE-502", "transform": _fix_yaml_load,
        "guidance": "Do not deserialize untrusted data with pickle; use yaml.safe_load for YAML "
                    "and a schema-validated JSON parser for other data."},
}

_DEFAULT = {"cwe": None, "transform": None,
            "guidance": "Review and remediate per your secure-coding standard."}


def remediation_for(detector: str) -> dict:
    return _REMEDIATIONS.get(detector, _DEFAULT)


def plan_for_finding(finding: dict) -> dict:
    """Guidance + optional deterministic suggested line for one code_finding."""
    rem = remediation_for(finding["detector"])
    original = finding.get("snippet") or ""
    suggested = rem["transform"](original) if rem["transform"] and original else None
    return {
        "finding_id": finding["id"], "detector": finding["detector"],
        "severity": finding["severity"], "file": finding["file"], "line": finding["line"],
        "cwe": rem["cwe"], "guidance": rem["guidance"],
        "original_line": original or None, "suggested_line": suggested,
        "auto_fixable": suggested is not None,
    }


def build_plan(scan_id: str) -> dict:
    """Remediation plan for every finding in a scan."""
    scan = github_svc.get_scan(scan_id)
    if not scan:
        raise ValueError(f"scan not found: {scan_id}")
    findings = [db.decode_row(r) for r in db.query(
        "SELECT * FROM code_findings WHERE scan_id=? ORDER BY line", [scan_id])]
    items = [plan_for_finding(f) for f in findings]
    return {"scan_id": scan_id, "repo": scan["repo"], "total": len(items),
            "auto_fixable": sum(1 for i in items if i["auto_fixable"]), "items": items}


def unified_diff(scan_id: str) -> str:
    """A unified-diff patch applying every deterministic single-line fix in the scan.

    Reads the scanned files from the scan's repo path (read-only) and rewrites only the
    offending lines that have a safe transform. The transform is applied to the REAL current
    file line (not the stored, stripped snippet) so indentation is preserved and a line that
    has since changed — where the transform no longer matches — is left untouched (stale-safe).
    Files without an auto-fixable finding are untouched. Returns "" when nothing changes.
    Never writes to disk.
    """
    scan = github_svc.get_scan(scan_id)
    if not scan:
        raise ValueError(f"scan not found: {scan_id}")
    findings = [db.decode_row(r) for r in db.query(
        "SELECT * FROM code_findings WHERE scan_id=? ORDER BY line", [scan_id])]
    repo = Path(scan["repo"])

    # Group fixable findings by file -> list of (line_no, transform).
    by_file: dict[str, list[tuple[int, object]]] = {}
    for f in findings:
        transform = remediation_for(f["detector"])["transform"]
        if transform is None:
            continue
        by_file.setdefault(f["file"], []).append((int(f["line"]), transform))

    chunks: list[str] = []
    for rel, edits in sorted(by_file.items()):
        path = repo / rel
        try:
            original = path.read_text(errors="ignore").splitlines(keepends=True)
        except OSError:
            continue
        patched = list(original)
        applied = False
        for lineno, transform in edits:
            idx = lineno - 1
            if not (0 <= idx < len(patched)):
                continue
            raw = patched[idx]
            eol = "\n" if raw.endswith("\n") else ""
            new_line = transform(raw.rstrip("\n"))  # apply to the real, indented line
            if new_line is not None and new_line + eol != raw:
                patched[idx] = new_line.rstrip("\n") + eol
                applied = True
        if not applied:
            continue
        diff = difflib.unified_diff(
            original, patched, fromfile=f"a/{rel}", tofile=f"b/{rel}")
        chunks.append("".join(diff))
    return "\n".join(c for c in chunks if c.strip())
