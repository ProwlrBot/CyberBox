"""Deterministic, tamper-evident CyberBox evidence bundles."""
from __future__ import annotations

import hashlib
import json
import uuid
import base64
from datetime import datetime, timezone

from .. import db
from ..config import get_settings
from . import artifacts, events
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _signing_key() -> Ed25519PrivateKey:
    path = get_settings().home / "evidence-signing.key"
    if path.exists():
        return Ed25519PrivateKey.from_private_bytes(path.read_bytes())
    key = Ed25519PrivateKey.generate()
    path.write_bytes(key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                       serialization.NoEncryption()))
    path.chmod(0o600)
    return key


def create(project_id: str, finding_ids: list[str], user_id: str | None = None) -> dict:
    findings = []
    artifact_index: dict[str, dict] = {}
    for finding_id in sorted(set(finding_ids)):
        finding = db.query_one("SELECT * FROM vulnerabilities WHERE id=? AND project_id=?",
                               [finding_id, project_id])
        if not finding:
            raise ValueError(f"finding does not belong to project: {finding_id}")
        links = db.query("SELECT * FROM finding_links WHERE vulnerability_id=?", [finding_id])
        reviews = [db.decode_row(r) for r in db.query(
            "SELECT * FROM finding_reviews WHERE vulnerability_id=? ORDER BY created_at, id", [finding_id])]
        artifact_ids = {item for review in reviews for item in review.get("artifact_ids", [])}
        for link in links:
            if link["hypothesis_id"]:
                hypothesis = db.decode_row(db.query_one("SELECT * FROM hypotheses WHERE id=?", [link["hypothesis_id"]]))
                artifact_ids.update(hypothesis.get("supporting_artifacts", []))
                artifact_ids.update(hypothesis.get("contradicting_artifacts", []))
        for artifact_id in sorted(artifact_ids):
            artifact = db.query_one("SELECT id, kind, media_type, sha256, size, metadata FROM artifacts WHERE id=?",
                                    [artifact_id])
            if artifact:
                artifact_index[artifact_id] = db.decode_row(artifact)
        findings.append({"finding": db.decode_row(finding), "links": links, "reviews": reviews})
    manifest = {"format": "cyberbox-evidence", "version": 1, "project_id": project_id,
                "findings": findings, "artifacts": [artifact_index[k] for k in sorted(artifact_index)]}
    content = _canonical(manifest)
    digest = hashlib.sha256(content).hexdigest()
    key = _signing_key()
    signature = base64.b64encode(key.sign(content)).decode()
    public_key = base64.b64encode(key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    artifact = artifacts.store(project_id, "evidence-bundle", content, "application/vnd.cyberbox.evidence+json",
                               metadata={"manifest_sha256": digest, "finding_ids": sorted(set(finding_ids))})
    row = {"id": str(uuid.uuid4()), "project_id": project_id, "artifact_id": artifact["id"],
           "manifest_sha256": digest, "finding_ids": json.dumps(sorted(set(finding_ids))),
           "signature": signature, "public_key": public_key,
           "created_by": user_id, "created_at": _now()}
    db.insert("evidence_bundles", row)
    events.append(project_id, "evidence.bundle_created", {"bundle_id": row["id"],
                  "sha256": digest, "finding_count": len(findings)})
    return db.decode_row(row)


def verify(bundle_id: str) -> dict:
    bundle = db.query_one("SELECT * FROM evidence_bundles WHERE id=?", [bundle_id])
    if not bundle:
        raise ValueError("evidence bundle not found")
    stored = artifacts.read(bundle["artifact_id"])
    if not stored:
        return {"valid": False, "reason": "bundle artifact missing or corrupted"}
    _, content = stored
    actual = hashlib.sha256(content).hexdigest()
    signature_valid = False
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(bundle["public_key"], validate=True)).verify(
            base64.b64decode(bundle["signature"], validate=True), content)
        signature_valid = True
    except (InvalidSignature, ValueError, TypeError):
        pass
    return {"valid": actual == bundle["manifest_sha256"] and signature_valid,
            "signature_valid": signature_valid, "expected_sha256": bundle["manifest_sha256"],
            "actual_sha256": actual, "artifact_id": bundle["artifact_id"]}
