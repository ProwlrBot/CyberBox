"""Signed knowledge-pack registration contracts."""
from __future__ import annotations

import json
import re
import hashlib
import uuid
from datetime import datetime, timezone

from .. import db

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def register(manifest: dict) -> dict:
    required = ("id", "name", "version", "source_url", "license", "sha256", "signature")
    missing = [key for key in required if not manifest.get(key)]
    if missing:
        raise ValueError(f"missing knowledge-pack fields: {', '.join(missing)}")
    if not SHA256_RE.fullmatch(str(manifest["sha256"]).lower()):
        raise ValueError("knowledge-pack sha256 must be 64 lowercase hex characters")
    if not str(manifest["source_url"]).startswith("https://"):
        raise ValueError("knowledge-pack source_url must use https")
    row = {
        "id": manifest["id"], "name": manifest["name"], "version": manifest["version"],
        "status": "registered", "source_url": manifest["source_url"],
        "license": manifest["license"], "sha256": manifest["sha256"].lower(),
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
