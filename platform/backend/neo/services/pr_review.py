"""Local PR review agent — static security checks on git diff."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

DETECTORS = [
    ("Hardcoded AWS access key", "high", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("Hardcoded private key", "critical", re.compile(r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("Hardcoded generic secret", "high",
     re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[=:]\s*['\"][^'\"]{12,}['\"]")),
    ("Use of eval()", "high", re.compile(r"\beval\s*\(")),
    ("Shell injection sink", "high",
     re.compile(r"os\.system\(|subprocess\.(call|run|Popen)\([^)]*shell\s*=\s*True")),
    ("SQL string concatenation", "medium",
     re.compile(r"(?i)(SELECT|INSERT|UPDATE|DELETE)\b.*[\"'].*\+\s*\w+")),
    ("Disabled TLS verification", "medium",
     re.compile(r"verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|rejectUnauthorized\s*:\s*false")),
    ("Insecure deserialization", "high",
     re.compile(r"pickle\.loads?\(|yaml\.load\((?!.*Loader)")),
]


def review_diff(repo: str, base: str | None = None) -> list[dict]:
    if not (Path(repo) / ".git").exists():
        return [{"error": f"{repo} is not a git repository"}]
    cmd = ["git", "-C", repo, "diff", "--unified=0"]
    if base:
        cmd.append(base)
    diff = subprocess.run(cmd, capture_output=True, text=True, timeout=120).stdout
    findings: list[dict] = []
    cur_file, cur_line = None, 0
    for raw in diff.splitlines():
        if raw.startswith("+++ b/"):
            cur_file = raw[6:]
            continue
        if raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            cur_line = int(m.group(1)) if m else 0
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            added = raw[1:]
            for name, severity, rx in DETECTORS:
                if rx.search(added):
                    findings.append({
                        "file": cur_file, "line": cur_line, "severity": severity,
                        "detector": name, "snippet": added.strip()[:200],
                        "comment": f"**{severity.upper()}: {name}**\n\n`{added.strip()[:160]}`",
                    })
            cur_line += 1
    return findings
