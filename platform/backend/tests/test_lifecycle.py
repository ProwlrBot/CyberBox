"""Six-stage lifecycle (gap #8b): stage gating, historical coverage, finder != validator."""
from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import lifecycle


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(dir="/dev/shm" if os.path.isdir("/dev/shm") else None)
        settings = Settings(home=Path(self.temp.name))
        settings.ensure_dirs()
        import cyberbox.config as config
        config._settings = settings
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        db.init_db()
        self.project_id = self._project()
        self.engagement_id = self._engagement(self.project_id)

    def tearDown(self) -> None:
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    # --- fixtures ---------------------------------------------------------
    def _project(self) -> str:
        pid = str(uuid.uuid4())
        db.insert("projects", {"id": pid, "slug": f"proj-{pid[:8]}", "name": "P", "created_at": _now()})
        return pid

    def _engagement(self, project_id: str) -> str:
        db.insert("profiles", {"id": "bug-bounty", "name": "BB", "version": "1",
                               "manifest": "{}", "created_at": _now()})
        eid = str(uuid.uuid4())
        db.insert("engagements", {"id": eid, "project_id": project_id, "name": "E",
                                  "profile_id": "bug-bounty", "created_at": _now()})
        return eid

    def _asset(self) -> str:
        aid = str(uuid.uuid4())
        db.insert("assets", {"id": aid, "project_id": self.project_id, "host": "x.example.com",
                             "first_seen": _now(), "last_seen": _now()})
        return aid

    def _hypothesis(self, created_by: str = "finder-1") -> str:
        hid = str(uuid.uuid4())
        db.insert("hypotheses", {"id": hid, "project_id": self.project_id,
                                 "engagement_id": self.engagement_id, "title": "H", "claim": "c",
                                 "created_by": created_by, "created_at": _now(), "updated_at": _now()})
        return hid

    def _experiment(self, hypothesis_id: str, target="https://x.example.com/a", method="GET",
                    procedure="probe", verdict: str | None = None) -> str:
        eid = str(uuid.uuid4())
        result = f'{{"verdict": "{verdict}"}}' if verdict else "{}"
        db.insert("experiments", {"id": eid, "hypothesis_id": hypothesis_id, "name": "X",
                                  "procedure": procedure, "risk_class": "low-impact",
                                  "target_url": target, "method": method, "expected_signal": "s",
                                  "status": "done" if verdict else "draft", "result": result,
                                  "created_at": _now()})
        return eid

    def _finding(self, hypothesis_id: str, verified: int = 0) -> str:
        fid = str(uuid.uuid4())
        db.insert("vulnerabilities", {"id": fid, "project_id": self.project_id, "name": "F",
                                      "severity": "high", "category": "idor", "description": "d",
                                      "host": "x.example.com", "matched_at": "x", "status": "open",
                                      "verified": verified, "poc": "p", "dedup_key": fid,
                                      "detected_at": _now()})
        db.insert("finding_links", {"vulnerability_id": fid, "hypothesis_id": hypothesis_id,
                                    "experiment_id": self._experiment(hypothesis_id)})
        return fid

    # --- stage machine ----------------------------------------------------
    def test_mission_starts_at_learn(self) -> None:
        m = lifecycle.create_mission(self.project_id, self.engagement_id, "M")
        self.assertEqual(m["stage"], "LEARN")

    def test_cannot_enter_map_without_assets(self) -> None:
        m = lifecycle.create_mission(self.project_id, self.engagement_id, "M")
        with self.assertRaises(ValueError):
            lifecycle.advance_stage(m["id"], "MAP")

    def test_map_unlocks_once_an_asset_exists(self) -> None:
        m = lifecycle.create_mission(self.project_id, self.engagement_id, "M")
        self._asset()
        out = lifecycle.advance_stage(m["id"], "MAP")
        self.assertEqual(out["stage"], "MAP")

    def test_cannot_skip_stages(self) -> None:
        m = lifecycle.create_mission(self.project_id, self.engagement_id, "M")
        self._asset()
        self._hypothesis()
        with self.assertRaises(ValueError):
            lifecycle.advance_stage(m["id"], "COORDINATE")  # still at LEARN, can't jump two

    def test_full_progression_to_verify(self) -> None:
        m = lifecycle.create_mission(self.project_id, self.engagement_id, "M")
        mid = m["id"]
        self._asset()
        lifecycle.advance_stage(mid, "MAP")
        hid = self._hypothesis()
        lifecycle.advance_stage(mid, "COORDINATE")
        exp = self._experiment(hid)
        lifecycle.advance_stage(mid, "TEST")
        # PROVE needs a supported experiment
        with self.assertRaises(ValueError):
            lifecycle.advance_stage(mid, "PROVE")
        self._experiment(hid, verdict="supported")
        lifecycle.advance_stage(mid, "PROVE")
        # VERIFY needs a verified finding
        with self.assertRaises(ValueError):
            lifecycle.advance_stage(mid, "VERIFY")
        self._finding(hid, verified=1)
        out = lifecycle.advance_stage(mid, "VERIFY")
        self.assertEqual(out["stage"], "VERIFY")

    def test_backward_transition_allowed(self) -> None:
        m = lifecycle.create_mission(self.project_id, self.engagement_id, "M")
        self._asset()
        lifecycle.advance_stage(m["id"], "MAP")
        out = lifecycle.advance_stage(m["id"], "LEARN")
        self.assertEqual(out["stage"], "LEARN")

    def test_stage_log_records_transitions(self) -> None:
        m = lifecycle.create_mission(self.project_id, self.engagement_id, "M")
        self._asset()
        lifecycle.advance_stage(m["id"], "MAP")
        full = lifecycle.get_mission(m["id"])
        stages = [e["to_stage"] for e in full["stage_log"]]
        self.assertEqual(stages, ["LEARN", "MAP"])

    # --- historical coverage ---------------------------------------------
    def test_coverage_detects_equivalent_experiment(self) -> None:
        hid = self._hypothesis()
        self._experiment(hid, target="https://x.example.com/a", method="GET", procedure="probe")
        hit = lifecycle.is_covered(self.engagement_id, "https://x.example.com/a/", "get", "probe")
        self.assertIsNotNone(hit)  # trailing slash + case normalized

    def test_coverage_misses_different_target(self) -> None:
        hid = self._hypothesis()
        self._experiment(hid, target="https://x.example.com/a")
        self.assertIsNone(lifecycle.is_covered(self.engagement_id, "https://x.example.com/b", "GET", "probe"))

    # --- finder != validator ---------------------------------------------
    def test_finder_cannot_verify_own_finding(self) -> None:
        hid = self._hypothesis(created_by="agent-A")
        fid = self._finding(hid)
        with self.assertRaises(ValueError):
            lifecycle.verify_finding(fid, "verifier", "agent-A", "confirmed", "high", "ok")

    def test_different_actor_can_verify(self) -> None:
        hid = self._hypothesis(created_by="agent-A")
        fid = self._finding(hid)
        review = lifecycle.verify_finding(fid, "verifier", "agent-B", "confirmed", "high", "ok")
        self.assertEqual(review["reviewer_id"], "agent-B")
        row = db.query_one("SELECT verified FROM vulnerabilities WHERE id=?", [fid])
        self.assertEqual(row["verified"], 1)

    def test_reviewer_id_required(self) -> None:
        hid = self._hypothesis()
        fid = self._finding(hid)
        with self.assertRaises(ValueError):
            lifecycle.verify_finding(fid, "verifier", "", "confirmed", "high", "ok")


if __name__ == "__main__":
    unittest.main()
