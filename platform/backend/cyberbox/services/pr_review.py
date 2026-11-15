"""Local code-scan detectors with false-positive suppression.

The detectors are deliberately simple regexes; the value add is `scan_line`, which runs them
AND filters the noise that makes naive secret scanners unusable: placeholder/example values,
values read from the environment, commented-out code, and anything under a test/fixture path.
Both the diff scanner (review_diff) and the full-tree scanner (services.github) go through
scan_line so suppression is applied uniformly.
"""
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

# Detectors that key on a literal value — these are the ones a placeholder or an env lookup
# turns into a false positive. The non-secret detectors (eval, shell, SQL) are structural and
# are not placeholder-suppressed.
_SECRET_DETECTORS = {"Hardcoded AWS access key", "Hardcoded private key", "Hardcoded generic secret"}

# Well-known fake/example/placeholder content — never a real leaked secret.
_PLACEHOLDER = re.compile(
    r"(?i)(example|placeholder|dummy|sample|your[-_ ]|change[-_ ]?me|<[a-z0-9_ -]+>|x{6,}|"
    r"\bfake\b|\bmock(ed)?\b|redacted|\.\.\.|todo|fixme|lorem|foobar|insert[-_ ]?here|000000)")
# Value is read from the environment / a secrets manager — not hardcoded.
_ENV_LOOKUP = re.compile(
    r"(?i)(os\.environ|os\.getenv|getenv\(|process\.env|\$\{?[a-z_][a-z0-9_]*\}?|"
    r"system\.getenv|secrets?\.|vault\.|\bENV\[|config\.get\()")
# Commented-out line (one-line comment leaders across common languages).
_COMMENT = re.compile(r"^\s*(#|//|\*|/\*|<!--|--\s)")
# Path that holds tests / fixtures / examples — leaked-secret signal there is almost always a fixture.
_TEST_PATH = re.compile(
    r"(?i)(^|/)(tests?|spec|specs?|fixtures?|examples?|mocks?|__tests__|__mocks__|testdata|"
    r"e2e|sample[-_ ]?data)(/|$)|\.(test|spec|example|sample)\.", )


def is_false_positive(detector: str, line: str, file: str | None) -> bool:
    """True if this detector hit on this line/file is almost certainly noise."""
    if file and _TEST_PATH.search(file):
        return True
    if _COMMENT.match(line):
        return True
    if detector in _SECRET_DETECTORS:
        if _ENV_LOOKUP.search(line) or _PLACEHOLDER.search(line):
            return True
    return False


def scan_line(line: str, file: str | None) -> list[tuple[str, str]]:
    """Return [(detector, severity)] for a single line, with FP suppression applied."""
    hits: list[tuple[str, str]] = []
    for name, severity, rx in DETECTORS:
        if rx.search(line) and not is_false_positive(name, line, file):
            hits.append((name, severity))
    return hits


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
            for name, severity in scan_line(added, cur_file):
                findings.append({
                    "file": cur_file, "line": cur_line, "severity": severity,
                    "detector": name, "snippet": added.strip()[:200],
                    "comment": f"**{severity.upper()}: {name}**\n\n`{added.strip()[:160]}`",
                })
            cur_line += 1
    return findings
