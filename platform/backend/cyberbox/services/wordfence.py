"""Safe CyberBox provider for local cve-intel Wordfence lab workflows."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")
WORKFLOWS: dict[str, tuple[tuple[str, ...], ...]] = {
    "preflight": (("doctor",), ("verify",)),
    "hunt": (("target", "hunt"), ("auth-audit",), ("research", "map"), ("fp", "review")),
    "verify": (("verification", "run"), ("report", "bundle")),
}


def cve_intel_root() -> Path:
    root = Path(os.environ.get("CYBERBOX_CVE_INTEL_ROOT", "/workspace/cve-intel")).expanduser()
    lab = root / "labs" / "tools" / "bin" / "lab"
    if not root.is_dir() or not lab.is_file():
        raise RuntimeError("CYBERBOX_CVE_INTEL_ROOT must point to a mounted cve-intel workspace")
    return root


def validate(slug: str, mode: str) -> None:
    if not isinstance(slug, str) or not SLUG_RE.fullmatch(slug):
        raise ValueError("slug must contain only lowercase letters, digits, and hyphens")
    if mode not in WORKFLOWS:
        raise ValueError("unsupported Wordfence workflow mode")


def commands(slug: str, mode: str, root: Path | None = None) -> list[list[str]]:
    validate(slug, mode)
    workspace = root or cve_intel_root()
    lab = str(workspace / "labs" / "tools" / "bin" / "lab")
    result: list[list[str]] = []
    for step in WORKFLOWS[mode]:
        argv = [lab, *step]
        if step not in (("doctor",), ("verify",)):
            argv.append(slug)
        result.append(argv)
    return result


def run(slug: str, mode: str, run_id: str, timeout: int = 1800) -> dict[str, Any]:
    validate(slug, mode)
    root = cve_intel_root()
    run_dir = root / "labs" / "findings" / "wordfence-runs" / f"cyberbox-{run_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "cyberbox.log"
    env = os.environ.copy()
    env["WP_HUNTER_LAB_ONLY"] = "true"
    output: list[str] = []
    exit_code = 0
    with log_path.open("w", encoding="utf-8") as log:
        for argv in commands(slug, mode, root):
            log.write("$ " + " ".join(argv) + "\n")
            proc = subprocess.run(argv, cwd=root, env=env, text=True, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, timeout=timeout, check=False)
            log.write(proc.stdout)
            output.append(proc.stdout[-4000:])
            if proc.returncode:
                exit_code = proc.returncode
                break
    return {"slug": slug, "mode": mode, "exit_code": exit_code,
            "log_path": str(log_path), "output": output}
