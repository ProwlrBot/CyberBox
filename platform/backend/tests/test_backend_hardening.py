"""De-stubbing + de-gating: knowledge verification, campaign engagement binding, github post guards."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from cyberbox import db
from cyberbox.config import Settings
from cyberbox.services import campaign, github, knowledge


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _pack(documents: list) -> dict:
    digest = hashlib.sha256(json.dumps(documents, sort_keys=True).encode()).hexdigest()
    return {"id": "pack-1", "name": "Pack", "version": "1", "source_url": "https://example.com/p",
            "license": "CC0", "sha256": digest, "signature": "AA==", "documents": documents}


class BackendHardeningTest(unittest.TestCase):
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
        self._prev_pubkey = os.environ.pop("CYBERBOX_KNOWLEDGE_PUBKEY", None)
        self.project_id = str(uuid.uuid4())
        db.insert("projects", {"id": self.project_id, "slug": f"p-{self.project_id[:8]}",
                               "name": "P", "created_at": _now()})
        db.insert("profiles", {"id": "bug-bounty", "name": "BB", "version": "1",
                               "manifest": "{}", "created_at": _now()})

    def tearDown(self) -> None:
        if self._prev_pubkey is not None:
            os.environ["CYBERBOX_KNOWLEDGE_PUBKEY"] = self._prev_pubkey
        else:
            os.environ.pop("CYBERBOX_KNOWLEDGE_PUBKEY", None)
        existing = getattr(db._local, "conn", None)
        if existing is not None:
            existing.close()
            del db._local.conn
        self.temp.cleanup()

    def _engagement(self, status: str = "active") -> str:
        eid = str(uuid.uuid4())
        db.insert("engagements", {"id": eid, "project_id": self.project_id, "name": "E",
                                  "profile_id": "bug-bounty", "status": status, "created_at": _now()})
        return eid

    # --- knowledge pack verification --------------------------------------
    def test_sha256_mismatch_rejected(self) -> None:
        pack = _pack([{"title": "D", "source_url": "https://x/d", "content": "body text here"}])
        pack["sha256"] = "0" * 64  # wrong
        with self.assertRaises(ValueError):
            knowledge.register(pack)

    def test_matching_sha256_registers_unverified_without_key(self) -> None:
        pack = _pack([{"title": "D", "source_url": "https://x/d", "content": "body text here"}])
        row = knowledge.register(pack)
        self.assertEqual(row["status"], "unverified")

    def test_valid_signature_marks_verified(self) -> None:
        key = Ed25519PrivateKey.generate()
        pub = key.public_key().public_bytes_raw()
        os.environ["CYBERBOX_KNOWLEDGE_PUBKEY"] = base64.b64encode(pub).decode()
        docs = [{"title": "D", "source_url": "https://x/d", "content": "body text here"}]
        pack = _pack(docs)
        sig = key.sign(pack["sha256"].encode())
        pack["signature"] = base64.b64encode(sig).decode()
        row = knowledge.register(pack)
        self.assertEqual(row["status"], "verified")

    def test_bad_signature_with_key_rejected(self) -> None:
        key = Ed25519PrivateKey.generate()
        os.environ["CYBERBOX_KNOWLEDGE_PUBKEY"] = base64.b64encode(
            key.public_key().public_bytes_raw()).decode()
        pack = _pack([{"title": "D", "source_url": "https://x/d", "content": "body text here"}])
        pack["signature"] = base64.b64encode(b"\x00" * 64).decode()  # not a valid signature
        with self.assertRaises(ValueError):
            knowledge.register(pack)

    # --- campaign engagement binding --------------------------------------
    def test_campaign_binds_authorized_engagement(self) -> None:
        eid = self._engagement("active")
        row = campaign.create_campaign(self.project_id, "C", "https://t.example.com",
                                       "full_auto", None, 1800)
        self.assertEqual(row["engagement_id"], eid)

    def test_campaign_no_engagement_is_null(self) -> None:
        row = campaign.create_campaign(self.project_id, "C", "https://t.example.com",
                                       "full_auto", None, 1800)
        self.assertIsNone(row["engagement_id"])

    # --- github post_results guards (no network) --------------------------
    def test_post_results_dry_run_by_default(self) -> None:
        scan_id = str(uuid.uuid4())
        db.insert("github_scans", {
            "id": scan_id, "source_id": None, "execution_id": None, "repo": "owner/repo",
            "revision": "abc", "base_revision": None, "pr_number": 7, "trigger": "manual",
            "scope": "full", "status": "completed", "fail_on": "high", "exit_code": 0,
            "summary": "{}", "created_at": _now(), "finished_at": _now()})
        result = github.post_results(scan_id, confirm=False)
        self.assertFalse(result["posted"])
        self.assertTrue(result["dry_run"])

    def test_post_results_rejects_non_slug_repo(self) -> None:
        scan_id = str(uuid.uuid4())
        db.insert("github_scans", {
            "id": scan_id, "source_id": None, "execution_id": None,
            "repo": "/home/anon/local/checkout", "revision": "abc", "base_revision": None,
            "pr_number": 7, "trigger": "manual", "scope": "full", "status": "completed",
            "fail_on": "high", "exit_code": 0, "summary": "{}", "created_at": _now(),
            "finished_at": _now()})
        os.environ["GITHUB_TOKEN"] = "x"
        try:
            result = github.post_results(scan_id, confirm=True)
        finally:
            os.environ.pop("GITHUB_TOKEN", None)
        self.assertFalse(result["posted"])
        self.assertIn("owner/repo slug", result["reason"])


if __name__ == "__main__":
    unittest.main()
