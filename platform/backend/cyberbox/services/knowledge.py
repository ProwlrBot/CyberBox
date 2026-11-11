"""Signed knowledge-pack registration contracts."""
from __future__ import annotations

import base64
import json
import os
import re
import hashlib
import uuid
from datetime import datetime, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .. import db

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
# Base64 Ed25519 public key of the party you trust to sign packs. When set, signatures
# are enforced and a pack is marked "verified"; when unset, packs are stored "unverified"
# (integrity is still checked) — never silently trusted.
_TRUSTED_PUBKEY_ENV = "CYBERBOX_KNOWLEDGE_PUBKEY"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _content_digest(documents: list) -> str:
    """Canonical sha256 over the pack's documents — the value `manifest.sha256` must match."""
    return hashlib.sha256(json.dumps(documents, sort_keys=True).encode()).hexdigest()


def _verify_signature(digest_hex: str, signature_b64: str) -> bool:
    """Verify an Ed25519 signature over the content digest against the trusted pubkey.

    Returns True on a valid signature. Raises ValueError if a trusted key is configured
    but the signature does not verify. Returns False when no trusted key is configured.
    """
    pub_b64 = os.environ.get(_TRUSTED_PUBKEY_ENV)
    if not pub_b64:
        return False
    try:
        public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(pub_b64, validate=True))
        public_key.verify(base64.b64decode(signature_b64, validate=True), digest_hex.encode())
        return True
    except (InvalidSignature, ValueError, TypeError) as exc:
        raise ValueError("knowledge-pack signature failed verification") from exc


def register(manifest: dict) -> dict:
    required = ("id", "name", "version", "source_url", "license", "sha256", "signature")
    missing = [key for key in required if not manifest.get(key)]
    if missing:
        raise ValueError(f"missing knowledge-pack fields: {', '.join(missing)}")
    declared = str(manifest["sha256"]).lower()
    if not SHA256_RE.fullmatch(declared):
        raise ValueError("knowledge-pack sha256 must be 64 lowercase hex characters")
    if not str(manifest["source_url"]).startswith("https://"):
        raise ValueError("knowledge-pack source_url must use https")

    # Integrity: the declared sha256 must match the actual content. Always enforced.
    actual = _content_digest(manifest.get("documents", []))
    if actual != declared:
        raise ValueError(
            f"knowledge-pack sha256 mismatch: manifest declares {declared} but documents "
            f"hash to {actual}")

    # Authenticity: enforce the Ed25519 signature only when a trusted key is configured.
    status = "verified" if _verify_signature(actual, str(manifest["signature"])) else "unverified"

    row = {
        "id": manifest["id"], "name": manifest["name"], "version": manifest["version"],
        "status": status, "source_url": manifest["source_url"],
        "license": manifest["license"], "sha256": declared,
        "signature": manifest["signature"], "manifest": json.dumps(manifest, sort_keys=True),
        "installed_at": _now(),
    }
    db.upsert("knowledge_packs", row, ["id", "version"],
              ["name", "status", "source_url", "license", "sha256", "signature", "manifest"])
    _index_documents(row, manifest.get("documents", []))
    return db.decode_row(row)


def _chunks(text: str, max_words: int = 220) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out: list[str] = []
    current: list[str] = []
    count = 0
    for paragraph in paragraphs:
        words = paragraph.split()
        if current and count + len(words) > max_words:
            out.append("\n\n".join(current))
            current, count = [], 0
        if len(words) > max_words:
            for start in range(0, len(words), max_words):
                if current:
                    out.append("\n\n".join(current))
                    current, count = [], 0
                out.append(" ".join(words[start:start + max_words]))
        else:
            current.append(paragraph)
            count += len(words)
    if current:
        out.append("\n\n".join(current))
    return out


def _index_documents(pack: dict, documents: list[dict]) -> None:
    for document in documents:
        content = str(document.get("content", "")).strip()
        source_url = str(document.get("source_url", ""))
        title = str(document.get("title", "")).strip()
        if not content or not title or not source_url.startswith("https://"):
            raise ValueError("each knowledge document requires title, https source_url, and content")
        digest = hashlib.sha256(content.encode()).hexdigest()
        document_id = str(uuid.uuid5(uuid.NAMESPACE_URL,
                                     f"{pack['id']}:{pack['version']}:{source_url}"))
        db.upsert("knowledge_documents", {
            "id": document_id, "pack_id": pack["id"], "pack_version": pack["version"],
            "title": title, "source_url": source_url,
            "license": document.get("license", pack["license"]), "content_sha256": digest,
            "metadata": json.dumps(document.get("metadata", {}), sort_keys=True), "created_at": _now(),
        }, ["pack_id", "pack_version", "source_url"],
           ["title", "license", "content_sha256", "metadata"])
        db.execute("DELETE FROM knowledge_chunks WHERE document_id=?", [document_id])
        for ordinal, chunk in enumerate(_chunks(content)):
            section = str(document.get("section", ""))
            chunk_digest = hashlib.sha256(chunk.encode()).hexdigest()
            db.insert("knowledge_chunks", {
                "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{document_id}:{ordinal}:{chunk_digest}")),
                "document_id": document_id, "section": section, "ordinal": ordinal,
                "content": chunk, "content_sha256": chunk_digest,
                "token_count": len(chunk.split()), "search_text": chunk.lower(),
            })


def search(query: str, profile_id: str | None = None, limit: int = 8) -> list[dict]:
    terms = sorted({term for term in re.findall(r"[a-z0-9_-]{2,}", query.lower())})
    if not terms:
        return []
    rows = db.query(
        "SELECT c.*, d.title, d.source_url, d.license, d.pack_id, d.pack_version, d.metadata "
        "FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id"
    )
    results = []
    for row in rows:
        pack = db.decode_row(db.query_one("SELECT manifest FROM knowledge_packs WHERE id=? AND version=?",
                                         [row["pack_id"], row["pack_version"]]))
        allowed_profiles = pack["manifest"].get("profiles", []) if pack else []
        if profile_id and allowed_profiles and profile_id not in allowed_profiles:
            continue
        text = row["search_text"]
        matches = sum(text.count(term) for term in terms)
        coverage = sum(1 for term in terms if term in text)
        if not coverage:
            continue
        score = round(coverage / len(terms) + min(matches, 10) / 100, 4)
        results.append({"chunk_id": row["id"], "text": row["content"], "score": score,
                        "citation": {"pack_id": row["pack_id"], "pack_version": row["pack_version"],
                                     "document_id": row["document_id"], "title": row["title"],
                                     "section": row["section"], "source_url": row["source_url"],
                                     "license": row["license"], "content_sha256": row["content_sha256"]}})
    return sorted(results, key=lambda item: (-item["score"], item["chunk_id"]))[:min(max(limit, 1), 50)]
