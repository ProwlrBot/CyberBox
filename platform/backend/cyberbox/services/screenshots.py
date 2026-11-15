"""Visual recon — headless-browser screenshots of in-scope hosts for fast attack-surface triage.

Two interchangeable backends behind one capture():
  - "chromium": shell out to a headless Chromium (Playwright-cached chrome-headless-shell if
    present, else a system chromium/chrome). Fast, zero extra dependency — the default.
  - "gowitness": drive ProjectDiscovery/sensepost gowitness v3 (`scan single`). Useful when you
    want gowitness's own chrome management or its report/jsonl pipeline for bulk host sweeps.
"auto" picks chromium when available, else gowitness. Either way the target host is checked
against the same SSRF guard as the fingerprint probe (cloud-metadata hard-blocked) and the caller
scope-gates the URL. PNGs are written under <home>/screenshots/<project>/ and served by an endpoint;
only the metadata lives in the DB.
"""
from __future__ import annotations

import glob
import re
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import asyncio

from .. import db
from ..config import get_settings
from . import toolspec
from .fingerprint import ProbeBlocked, _assert_not_metadata

_TIMEOUT = 45
_WINDOW = (1280, 800)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _chrome_binary() -> str | None:
    """Prefer the Playwright-cached headless shell (newest), else a system chromium/chrome."""
    patterns = [
        str(Path.home() / ".cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell"),
        str(Path.home() / ".cache/ms-playwright/chromium-*/chrome-linux*/chrome"),
    ]
    cands: list[str] = []
    for pat in patterns:
        cands.extend(glob.glob(pat))
    if cands:
        # Highest build number wins (…-1254 > …-1248).
        def build_num(p: str) -> int:
            m = re.search(r"-(\d+)/", p)
            return int(m.group(1)) if m else 0
        return sorted(cands, key=build_num)[-1]
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _gowitness_binary() -> str | None:
    found = shutil.which("gowitness")
    if found:
        return found
    cand = Path.home() / "go/bin/gowitness"
    return str(cand) if cand.exists() else None


def _resolve_backend(backend: str) -> str:
    """Map 'auto' to a concrete backend. chromium preferred (proven, fast single-shot)."""
    if backend == "chromium":
        return "chromium"
    if backend == "gowitness":
        return "gowitness"
    # auto
    if _chrome_binary():
        return "chromium"
    if _gowitness_binary():
        return "gowitness"
    return "chromium"  # will error cleanly downstream with "no headless browser available"


def available(backend: str = "auto") -> bool:
    if backend == "gowitness":
        return _gowitness_binary() is not None
    if backend == "chromium":
        return _chrome_binary() is not None
    return _chrome_binary() is not None or _gowitness_binary() is not None


def _capture_chromium(url: str, out_path: Path) -> str | None:
    """Run headless Chromium → out_path (PNG). Returns an error string or None on success."""
    binary = _chrome_binary()
    if not binary:
        return "no headless browser available"
    with tempfile.TemporaryDirectory() as profile:
        try:
            subprocess.run(
                [binary, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
                 f"--user-data-dir={profile}", f"--window-size={_WINDOW[0]},{_WINDOW[1]}",
                 "--virtual-time-budget=5000", f"--screenshot={out_path}", url],
                capture_output=True, timeout=_TIMEOUT, check=False)
        except (subprocess.TimeoutExpired, OSError) as exc:
            return str(exc)[:200]
    return None


def _capture_gowitness(url: str, out_path: Path) -> str | None:
    """Run gowitness v3 `scan single` into a temp dir, move the produced PNG to out_path."""
    binary = _gowitness_binary()
    if not binary:
        return "gowitness not installed"
    chrome = _chrome_binary()  # reuse our cached chrome; else gowitness manages its own
    with tempfile.TemporaryDirectory() as shot_dir:
        cmd = [binary, "scan", "single", "-u", url, "-s", shot_dir,
               "--screenshot-format", "png", "--timeout", str(_TIMEOUT), "--delay", "2",
               "--chrome-window-x", str(_WINDOW[0]), "--chrome-window-y", str(_WINDOW[1])]
        if chrome:
            cmd += ["--chrome-path", chrome]
        try:
            subprocess.run(cmd, capture_output=True, timeout=_TIMEOUT + 20, check=False)
        except (subprocess.TimeoutExpired, OSError) as exc:
            return str(exc)[:200]
        pngs = sorted(glob.glob(str(Path(shot_dir) / "*.png")),
                      key=lambda p: Path(p).stat().st_size, reverse=True)
        if not pngs:
            return "gowitness produced no image"
        shutil.move(pngs[0], out_path)
    return None


def capture(project_id: str, url: str, backend: str = "auto") -> dict:
    """Screenshot `url` and store the PNG + a metadata row.

    SSRF-guarded (cloud-metadata blocked). `backend` is one of auto|chromium|gowitness. Returns
    the stored row dict. On a browser failure the row is recorded with status='error' rather than
    raising, so a batch never half-fails silently."""
    sp = urlsplit(url)
    if sp.scheme not in ("http", "https") or not sp.hostname:
        raise ProbeBlocked("invalid screenshot URL")
    _assert_not_metadata(sp.hostname)  # raises ProbeBlocked on a metadata host

    chosen = _resolve_backend(backend)
    shot_id = str(uuid.uuid4())
    settings = get_settings()
    settings.ensure_dirs()
    out_dir = settings.screenshots_dir / project_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{shot_id}.png"

    if chosen == "gowitness":
        error = _capture_gowitness(url, out_path)
    else:
        error = _capture_chromium(url, out_path)

    ok = out_path.exists() and out_path.stat().st_size > 0
    row = {
        "id": shot_id, "project_id": project_id, "url": url,
        "path": str(out_path) if ok else None, "title": sp.netloc,
        "width": _WINDOW[0] if ok else 0, "height": _WINDOW[1] if ok else 0,
        "status": "ok" if ok else "error",
        "error": None if ok else (error or "browser produced no image"),
        "captured_at": _now(),
    }
    db.insert("screenshots", row)
    return row


def list_shots(project_id: str) -> list[dict]:
    rows = db.query(
        "SELECT id, url, title, width, height, status, error, captured_at FROM screenshots "
        "WHERE project_id=? ORDER BY captured_at DESC LIMIT 500", [project_id])
    return rows


def get_shot(shot_id: str) -> dict | None:
    return db.query_one("SELECT * FROM screenshots WHERE id=?", [shot_id])


# ── gowitness as a routed tool (both modes) ─────────────────────────────────────

async def _run_gowitness(campaign_id, project_id: str, args: dict,
                         execution_id: str, phase: str, max_runtime: int) -> tuple[int, object]:
    """ToolSpec runner for gowitness — screenshot each in-scope URL (args.urls, or a single
    args.target_url). The up-front gate only scope-checks one representative target, so this
    runner re-filters EVERY url through the project scope before capturing — a multi-target
    tool never reaches an out-of-scope host. capture() adds the SSRF guard on top."""
    from . import policy as policy_svc
    urls = args.get("urls") or ([args["target_url"]] if args.get("target_url") else [])
    if not urls:
        return (1, {"error": "no urls/target_url to screenshot"})
    engagement = policy_svc.authorized_engagement(project_id)
    if not engagement:
        return (1, {"error": "no authorized engagement"})
    # Scope-only filter: keep URLs whose scope decision is 'allowed' (in scope). The approval
    # layer (requires_approval) is NOT re-applied here — the operator/orchestrator already
    # cleared that in the up-front gate; this pass only stops out-of-scope hosts.
    shots: list[dict] = []
    allowed_urls: list[str] = []
    for url in urls:
        u = url if "://" in url else f"https://{url}"
        try:
            dec = policy_svc.evaluate(engagement["id"], u, method="GET", risk_class="low-impact")
        except Exception as exc:  # noqa: BLE001 — a failing scope check must block, not pass
            dec = {"allowed": False, "reason": f"policy error: {exc}"}
        if dec.get("allowed"):
            allowed_urls.append(url)
        else:
            shots.append({"url": url, "status": "blocked", "error": dec.get("reason", "out of scope")})
    for url in allowed_urls:
        try:
            row = await asyncio.to_thread(capture, project_id, url, "gowitness")
            shots.append({"id": row["id"], "url": url, "status": row["status"],
                          "error": row.get("error")})
        except ProbeBlocked as exc:
            shots.append({"url": url, "status": "error", "error": str(exc)})
    rc = 0 if any(s["status"] == "ok" for s in shots) else 1
    return (rc, {"captured": sum(1 for s in shots if s["status"] == "ok"), "shots": shots})


toolspec.register(toolspec.ToolSpec(
    name="gowitness", category="recon", danger_tier="active", scope_required=1,
    description="Headless-browser screenshots via gowitness v3 — visual recon of in-scope hosts.",
    modes=("manual", "ai"), phase="recon"))
toolspec.bind_runner("gowitness", _run_gowitness,
                     available=lambda: _gowitness_binary() is not None)
