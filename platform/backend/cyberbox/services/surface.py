"""Attack-surface monitoring — snapshot a project's live hosts and diff for drift.

A snapshot is the sorted set of host:port:scheme fingerprints known for a project at a point
in time. Drift is the set difference between the two most recent snapshots: hosts that
appeared (new attack surface to look at) and hosts that vanished. This is what turns one-shot
recon into continuous monitoring.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from .. import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fingerprints(project_id: str) -> list[str]:
    rows = db.query("SELECT host, port, scheme FROM assets WHERE project_id=?", [project_id])
    return sorted(f"{r['scheme']}://{r['host']}:{r['port']}" for r in rows)


def snapshot(project_id: str) -> dict:
    """Capture the current host set as a snapshot. Returns the snapshot row."""
    fps = _fingerprints(project_id)
    row = {"id": str(uuid.uuid4()), "project_id": project_id,
           "hosts": json.dumps(fps), "host_count": len(fps), "created_at": _now()}
    db.insert("surface_snapshots", row)
    return db.decode_row(row)


def latest_snapshots(project_id: str, n: int = 2) -> list[dict]:
    return [db.decode_row(r) for r in db.query(
        "SELECT * FROM surface_snapshots WHERE project_id=? ORDER BY created_at DESC LIMIT ?",
        [project_id, n])]


def drift(project_id: str) -> dict:
    """Diff the two most recent snapshots. With fewer than two, drift is empty (nothing to
    compare yet). added = hosts in the newer but not the older; removed = the reverse."""
    snaps = latest_snapshots(project_id, 2)
    if len(snaps) < 2:
        current = set(snaps[0]["hosts"]) if snaps else set()
        return {"added": [], "removed": [], "current_count": len(current),
                "baseline": bool(snaps), "compared": False}
    newer, older = set(snaps[0]["hosts"]), set(snaps[1]["hosts"])
    return {"added": sorted(newer - older), "removed": sorted(older - newer),
            "current_count": len(newer), "baseline": True, "compared": True,
            "from": snaps[1]["created_at"], "to": snaps[0]["created_at"]}


def snapshot_and_drift(project_id: str) -> dict:
    """Take a fresh snapshot, then report drift against the previous one — the scheduler path."""
    snap = snapshot(project_id)
    d = drift(project_id)
    d["snapshot_id"] = snap["id"]
    return d
