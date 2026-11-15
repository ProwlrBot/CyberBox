"""cve-intel adapter — run the user's WordPress plugin/theme hunt as a CyberBox job.

This is an ADAPTER, not a copy: CyberBox shells out to the cve-intel repo's own
entrypoint (`scripts/hunt.sh <slug>`) and ingests its candidate artifacts. Nothing
from cve-intel is vendored in.

Safety model (mirrors the standing constraints):
  * Default mode is STATIC — `hunt.sh <slug> --static` runs the read-only wf-hunt
    (static source analysis of the published plugin), no live-exploit bench, no
    submission. The runtime/bench mode ("full") is only reachable when a job's spec
    explicitly opts in with mode="full", so a scheduled job is read-only unless a
    human set it otherwise.
  * The slug is strictly validated (WordPress slug charset) before it ever reaches a
    subprocess argv — no shell string is built, args are passed as a list.
  * The cve-intel location is resolved from spec.repo -> $CVE_INTEL_HOME -> ~/cve-intel;
    never hardcoded into business logic, no secrets stored here (cve-intel reads its own
    CVE_INTEL_* secrets from the OS env, same convention as notify.py).
  * No network/exploit action is initiated by CyberBox itself — cve-intel owns that, and
    its own defaults are read-only / no-auto-submit.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}$")
_DEFAULT_TIMEOUT = 1800  # 30 min hard cap on a single hunt
_MODES = {"static", "full"}


def resolve_repo(repo: str | None = None) -> Path:
    """spec.repo -> $CVE_INTEL_HOME -> ~/cve-intel. Must contain scripts/hunt.sh."""
    candidate = repo or os.environ.get("CVE_INTEL_HOME") or str(Path.home() / "cve-intel")
    root = Path(candidate).expanduser().resolve()
    if not (root / "scripts" / "hunt.sh").is_file():
        raise FileNotFoundError(
            f"cve-intel not found at {root} (no scripts/hunt.sh). "
            "Set spec.repo or $CVE_INTEL_HOME.")
    return root


def _candidate_summary(root: Path, slug: str) -> dict:
    """Best-effort read of cve-intel's own candidate index for this slug."""
    index = root / "labs" / "findings" / slug / "candidates" / "index.json"
    if not index.is_file():
        return {"candidates": 0, "index_path": None}
    try:
        data = json.loads(index.read_text())
    except (OSError, ValueError):
        return {"candidates": 0, "index_path": str(index)}
    # Index may be a list of candidate records, or {"candidates":[...]}.
    if isinstance(data, dict):
        items = data.get("candidates") or data.get("items") or []
    elif isinstance(data, list):
        items = data
    else:
        items = []
    return {"candidates": len(items), "index_path": str(index)}


def run_hunt(slug: str, mode: str = "static", theme: bool = False,
             repo: str | None = None, timeout: int = _DEFAULT_TIMEOUT) -> dict:
    """Run cve-intel's hunt for one plugin/theme slug and summarise the result.

    Returns a dict (never raises for a non-zero hunt exit — a failed hunt is a
    result, not an adapter error); raises only for bad input or a missing repo.
    """
    slug = (slug or "").strip().lower()
    if not _SLUG_RE.match(slug):
        raise ValueError(f"invalid plugin/theme slug {slug!r}")
    if mode not in _MODES:
        raise ValueError(f"mode must be one of {sorted(_MODES)}, got {mode!r}")
    root = resolve_repo(repo)

    cmd = ["bash", "scripts/hunt.sh", slug]
    if mode == "static":
        cmd.append("--static")
    else:  # mode == "full": explicit opt-in to the bench/runtime pipeline
        cmd.append("--full")
    if theme:
        cmd.append("--theme")

    try:
        proc = subprocess.run(
            cmd, cwd=str(root), capture_output=True, text=True,
            timeout=timeout, check=False)
        returncode = proc.returncode
        stdout, stderr = proc.stdout, proc.stderr
        timed_out = False
    except subprocess.TimeoutExpired as exc:
        returncode = None
        stdout = exc.stdout or ""
        stderr = (exc.stderr or "") + f"\n[adapter] timed out after {timeout}s"
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", "replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", "replace")
        timed_out = True

    summary = _candidate_summary(root, slug)
    return {
        "ok": (returncode == 0) and not timed_out,
        "slug": slug,
        "mode": mode,
        "theme": theme,
        "repo": str(root),
        "returncode": returncode,
        "timed_out": timed_out,
        "candidates": summary["candidates"],
        "index_path": summary["index_path"],
        "stdout_tail": stdout[-2000:],
        "stderr_tail": stderr[-1000:],
    }
