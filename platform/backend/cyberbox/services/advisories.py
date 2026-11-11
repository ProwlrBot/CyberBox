"""Advisory store — Patchstack/CVE/NVD records plus affected-version ranges.

Authoritative state for correlating a product@version against known vulnerabilities
(Phase 5 WordPress work, patch-diff/regression). Imports are deduped by (source,
external_id) and a content hash so re-imports update in place instead of duplicating.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone

from .. import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def content_hash(data: dict) -> str:
    """Stable dedup hash over the identifying fields of an advisory."""
    key = json.dumps(
        {k: data.get(k) for k in ("source", "external_id", "title", "product_slug")},
        sort_keys=True,
    )
    return hashlib.sha256(key.encode()).hexdigest()


def _version_tuple(version: str) -> tuple:
    """Parse a dotted version into a comparable tuple; non-numeric parts compare as strings."""
    parts: list = []
    for chunk in str(version).replace("-", ".").split("."):
        parts.append((0, int(chunk)) if chunk.isdigit() else (1, chunk))
    return tuple(parts)


def version_affected(version: str, introduced: str | None, fixed: str | None) -> bool:
    """True if `version` falls in [introduced, fixed): introduced inclusive, fixed exclusive."""
    v = _version_tuple(version)
    if introduced and v < _version_tuple(introduced):
        return False
    if fixed and v >= _version_tuple(fixed):
        return False
    return True


def upsert_advisory(data: dict) -> str:
    """Insert or update an advisory by (source, external_id). Returns the advisory id."""
    source = data["source"]
    external_id = data.get("external_id")
    existing = None
    if external_id:
        existing = db.query_one(
            "SELECT id FROM advisories WHERE source=? AND external_id=?", [source, external_id])
    advisory_id = existing["id"] if existing else str(uuid.uuid4())
    row = {
        "id": advisory_id, "source": source, "external_id": external_id,
        "title": data["title"], "description": data.get("description"),
        "severity": (data.get("severity") or "unknown").lower(),
        "cvss": data.get("cvss"), "cwe": data.get("cwe"),
        "product_type": data.get("product_type"), "product_slug": data.get("product_slug"),
        "published_at": data.get("published_at"),
        "reference_urls": json.dumps(data.get("references", [])),
        "raw": json.dumps(data.get("raw", {})),
        "content_hash": content_hash(data), "created_at": _now(),
    }
    db.upsert(
        "advisories", row, conflict_cols=["source", "external_id"],
        update_cols=["title", "description", "severity", "cvss", "cwe", "product_type",
                     "product_slug", "published_at", "reference_urls", "raw", "content_hash"],
    )
    return advisory_id


def add_affected_version(advisory_id: str, product_slug: str,
                         introduced: str | None = None, fixed: str | None = None,
                         constraint: str | None = None) -> str:
    av_id = str(uuid.uuid4())
    db.insert("affected_versions", {
        "id": av_id, "advisory_id": advisory_id, "product_slug": product_slug,
        "version_introduced": introduced, "version_fixed": fixed,
        "version_constraint": constraint, "created_at": _now(),
    })
    return av_id


def get_advisory(advisory_id: str) -> dict | None:
    row = db.query_one("SELECT * FROM advisories WHERE id=?", [advisory_id])
    if not row:
        return None
    advisory = db.decode_row(row)
    advisory["affected_versions"] = [
        db.decode_row(r) for r in db.query(
            "SELECT * FROM affected_versions WHERE advisory_id=?", [advisory_id])
    ]
    return advisory


def list_advisories(product_slug: str | None = None, source: str | None = None,
                    limit: int = 100) -> list[dict]:
    sql = "SELECT * FROM advisories"
    clauses, params = [], []
    if product_slug:
        clauses.append("product_slug=?")
        params.append(product_slug)
    if source:
        clauses.append("source=?")
        params.append(source)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY published_at DESC, created_at DESC LIMIT ?"
    params.append(limit)
    return [db.decode_row(r) for r in db.query(sql, params)]


def match_product(product_slug: str, version: str) -> list[dict]:
    """Advisories whose affected range covers product_slug@version."""
    ranges = db.query(
        "SELECT av.*, a.external_id, a.title, a.severity FROM affected_versions av "
        "JOIN advisories a ON a.id = av.advisory_id WHERE av.product_slug=?",
        [product_slug],
    )
    hits: list[dict] = []
    for r in ranges:
        if version_affected(version, r["version_introduced"], r["version_fixed"]):
            hits.append({
                "advisory_id": r["advisory_id"], "external_id": r["external_id"],
                "title": r["title"], "severity": r["severity"],
                "version_introduced": r["version_introduced"],
                "version_fixed": r["version_fixed"],
            })
    return hits
