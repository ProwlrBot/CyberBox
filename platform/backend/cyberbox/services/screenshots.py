"""Visual recon — headless-browser screenshots of in-scope hosts for fast attack-surface triage.

Shells out to a headless Chromium (the Playwright-cached chrome-headless-shell if present, else a
system chromium/chrome) to screenshot a URL. No gowitness dependency. The target host is checked
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

from .. import db
from ..config import get_settings
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


def available() -> bool:
    return _chrome_binary() is not None


def capture(project_id: str, url: str) -> dict:
    """Screenshot `url` with headless Chromium and store the PNG + a metadata row.

    SSRF-guarded (cloud-metadata blocked). Returns the stored row dict. On a browser failure the
    row is recorded with status='error' rather than raising, so a batch never half-fails silently."""
    sp = urlsplit(url)
    if sp.scheme not in ("http", "https") or not sp.hostname:
        raise ProbeBlocked("invalid screenshot URL")
    _assert_not_metadata(sp.hostname)  # raises ProbeBlocked on a metadata host

    binary = _chrome_binary()
    shot_id = str(uuid.uuid4())
    if not binary:
        row = {"id": shot_id, "project_id": project_id, "url": url, "path": None, "title": None,
               "width": 0, "height": 0, "status": "error", "error": "no headless browser available",
               "captured_at": _now()}
        db.insert("screenshots", row)
        return row

    settings = get_settings()
    settings.ensure_dirs()
    out_dir = settings.screenshots_dir / project_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{shot_id}.png"

    error = None
    with tempfile.TemporaryDirectory() as profile:
        try:
            subprocess.run(
                [binary, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
                 f"--user-data-dir={profile}", f"--window-size={_WINDOW[0]},{_WINDOW[1]}",
                 "--virtual-time-budget=5000", f"--screenshot={out_path}", url],
                capture_output=True, timeout=_TIMEOUT, check=False)
        except (subprocess.TimeoutExpired, OSError) as exc:
            error = str(exc)[:200]

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
