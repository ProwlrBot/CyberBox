"""API Genome — normalize HAR, OpenAPI, Burp XML, and Caido exports into
a unified endpoint inventory for a project.

Each source format is parsed into the same `endpoints` table rows:
  method, host, path, path_template, params, auth_required, auth_schemes,
  content_types, request_body_schema, status_codes, tags, drift_flags

Drift detection compares a declared OpenAPI spec against observed HAR traffic
and writes a `drift_flags` list when spec and reality disagree.
"""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse, parse_qs

from .. import db
from . import events

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


_PATH_PARAM_RE = re.compile(r"/(\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24,})")


def _templatize(path: str) -> str:
    """Replace numeric IDs and UUIDs in a path with {id} placeholders."""
    return _PATH_PARAM_RE.sub("/{id}", path)


def _auth_from_headers(headers: dict) -> tuple[int, list[str]]:
    schemes: list[str] = []
    lower = {k.lower(): v for k, v in headers.items()}
    if "authorization" in lower:
        v = lower["authorization"].lower()
        schemes.append("bearer" if v.startswith("bearer") else "basic" if v.startswith("basic") else "auth")
    if "cookie" in lower:
        schemes.append("cookie")
    for h in ("x-api-key", "api-key", "apikey"):
        if h in lower:
            schemes.append("apikey")
    return (1 if schemes else 0), schemes


def _upsert_endpoint(project_id: str, source: str, row_data: dict) -> dict:
    """Insert or merge an endpoint row. Returns the final row."""
    existing = db.query_one(
        "SELECT * FROM endpoints WHERE project_id=? AND method=? AND host=? AND path=?",
        [project_id, row_data["method"], row_data["host"], row_data["path"]],
    )
    now = _now()
    if existing:
        # Merge: extend status_codes and auth_schemes lists; update last_seen
        existing_codes = json.loads(existing["status_codes"] or "[]")
        new_codes = json.loads(row_data.get("status_codes", "[]"))
        merged_codes = sorted(set(existing_codes) | set(new_codes))

        existing_schemes = json.loads(existing["auth_schemes"] or "[]")
        new_schemes = json.loads(row_data.get("auth_schemes", "[]"))
        merged_schemes = sorted(set(existing_schemes) | set(new_schemes))

        existing_tags = json.loads(existing["tags"] or "[]")
        new_tags = json.loads(row_data.get("tags", "[]"))
        merged_tags = sorted(set(existing_tags) | set(new_tags))

        db.execute(
            "UPDATE endpoints SET status_codes=?, auth_schemes=?, auth_required=?, "
            "tags=?, last_seen_at=?, source=? WHERE id=?",
            [json.dumps(merged_codes), json.dumps(merged_schemes),
             max(int(existing["auth_required"]), int(row_data.get("auth_required", 0))),
             json.dumps(merged_tags), now, source, existing["id"]],
        )
        return db.query_one("SELECT * FROM endpoints WHERE id=?", [existing["id"]])  # type: ignore[return-value]

    eid = str(uuid.uuid4())
    row = {
        "id":                  eid,
        "project_id":          project_id,
        "source":              source,
        "method":              row_data["method"],
        "host":                row_data["host"],
        "path":                row_data["path"],
        "path_template":       row_data.get("path_template") or _templatize(row_data["path"]),
        "params":              json.dumps(row_data.get("params") or []),
        "auth_required":       int(row_data.get("auth_required", 0)),
        "auth_schemes":        json.dumps(row_data.get("auth_schemes") or []),
        "content_types":       json.dumps(row_data.get("content_types") or []),
        "request_body_schema": row_data.get("request_body_schema"),
        "status_codes":        json.dumps(row_data.get("status_codes") or []),
        "tags":                json.dumps(row_data.get("tags") or []),
        "drift_flags":         json.dumps([]),
        "first_seen_at":       now,
        "last_seen_at":        now,
    }
    db.insert("endpoints", row)
    return row


# ---------------------------------------------------------------------------
# HAR ingest
# ---------------------------------------------------------------------------

def ingest_har(project_id: str, har: dict) -> dict:
    """Parse a HAR 1.2/1.3 object and upsert endpoints into the project."""
    entries = har.get("log", {}).get("entries", [])
    imported = 0
    skipped = 0
    for entry in entries:
        req = entry.get("request", {})
        resp = entry.get("response", {})
        raw_url = req.get("url", "")
        if not raw_url:
            skipped += 1
            continue
        try:
            parsed = urlparse(raw_url)
        except Exception:
            skipped += 1
            continue

        method = req.get("method", "GET").upper()
        host = parsed.netloc or parsed.hostname or ""
        path = parsed.path or "/"

        # Query params
        qs = parse_qs(parsed.query or "")
        params = [{"name": k, "in": "query", "required": False} for k in qs]
        # POST params
        for pp in req.get("postData", {}).get("params", []):
            params.append({"name": pp.get("name", ""), "in": "body", "required": False})

        req_headers = {h["name"]: h["value"] for h in req.get("headers", [])}
        auth_required, auth_schemes = _auth_from_headers(req_headers)

        content_types = []
        for h in resp.get("headers", []):
            if h.get("name", "").lower() == "content-type":
                ct = h["value"].split(";")[0].strip()
                if ct not in content_types:
                    content_types.append(ct)

        status = resp.get("status")
        status_codes = [status] if status else []

        _upsert_endpoint(project_id, "har", {
            "method": method,
            "host": host,
            "path": path,
            "params": params,
            "auth_required": auth_required,
            "auth_schemes": auth_schemes,
            "content_types": content_types,
            "status_codes": status_codes,
        })
        imported += 1

    events.append(project_id, "genome.har_imported",
                  {"imported": imported, "skipped": skipped},
                  actor_type="system")
    return {"imported": imported, "skipped": skipped, "source": "har"}


# ---------------------------------------------------------------------------
# OpenAPI 3.x / Swagger 2.0 ingest
# ---------------------------------------------------------------------------

def ingest_openapi(project_id: str, spec: dict) -> dict:
    """Parse an OpenAPI 3.x or Swagger 2.0 object and upsert endpoints."""
    version = spec.get("openapi", spec.get("swagger", ""))
    imported = 0

    # Determine base host
    if str(version).startswith("3"):
        servers = spec.get("servers", [])
        host = ""
        if servers:
            try:
                host = urlparse(servers[0].get("url", "")).netloc
            except Exception:
                pass
    else:  # Swagger 2.0
        host = spec.get("host", "")

    paths = spec.get("paths", {})
    for path_str, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method in ("get", "post", "put", "patch", "delete", "options", "head"):
            operation = path_item.get(method)
            if not isinstance(operation, dict):
                continue

            # Parameters
            params: list[dict] = []
            combined_params = path_item.get("parameters", []) + operation.get("parameters", [])
            for p in combined_params:
                if not isinstance(p, dict):
                    continue
                params.append({
                    "name":     p.get("name", ""),
                    "in":       p.get("in", "query"),
                    "required": bool(p.get("required", False)),
                    "type":     p.get("schema", {}).get("type", p.get("type", "")),
                })

            # Request body schema (OAS3)
            rb_schema = None
            rb = operation.get("requestBody", {})
            if rb:
                for ct_key, ct_val in rb.get("content", {}).items():
                    if "schema" in ct_val:
                        rb_schema = json.dumps(ct_val["schema"])
                        break

            # Auth from security
            auth_required = 0
            auth_schemes: list[str] = []
            sec = operation.get("security", spec.get("security", []))
            if sec:
                auth_required = 1
                sec_defs = spec.get("components", {}).get("securitySchemes",
                           spec.get("securityDefinitions", {}))
                for item in sec:
                    for scheme_name in item:
                        defn = sec_defs.get(scheme_name, {})
                        t = defn.get("type", "").lower()
                        if t == "http":
                            auth_schemes.append(defn.get("scheme", "bearer").lower())
                        elif t == "apikey":
                            auth_schemes.append("apikey")
                        elif t == "oauth2":
                            auth_schemes.append("bearer")
                        elif t == "openidconnect":
                            auth_schemes.append("bearer")

            tags = operation.get("tags", [])

            _upsert_endpoint(project_id, "openapi", {
                "method":               method.upper(),
                "host":                 host,
                "path":                 path_str,
                "path_template":        path_str,  # already templated in OAS
                "params":               params,
                "auth_required":        auth_required,
                "auth_schemes":         auth_schemes,
                "request_body_schema":  rb_schema,
                "tags":                 tags,
            })
            imported += 1

    events.append(project_id, "genome.openapi_imported",
                  {"imported": imported, "version": str(version)},
                  actor_type="system")
    return {"imported": imported, "source": "openapi", "spec_version": str(version)}


# ---------------------------------------------------------------------------
# Burp Suite XML ingest (export from Proxy > Save items)
# ---------------------------------------------------------------------------

def ingest_burp_xml(project_id: str, xml_text: str) -> dict:
    """Parse a Burp Suite proxy-items XML export."""
    import xml.etree.ElementTree as ET  # stdlib, safe for trusted exports
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"invalid Burp XML: {exc}") from exc

    imported = 0
    skipped = 0
    for item in root.findall(".//item"):
        url_el = item.find("url")
        method_el = item.find("method")
        status_el = item.find("status")
        if url_el is None or not (url_el.text or "").strip():
            skipped += 1
            continue
        raw_url = (url_el.text or "").strip()
        try:
            parsed = urlparse(raw_url)
        except Exception:
            skipped += 1
            continue

        method = (method_el.text or "GET").strip().upper() if method_el is not None else "GET"
        host = parsed.netloc or ""
        path = parsed.path or "/"
        status = int(status_el.text or 0) if status_el is not None else None

        # Parse raw request headers for auth indicators
        req_el = item.find("request")
        auth_required, auth_schemes = 0, []
        if req_el is not None:
            raw_req = req_el.text or ""
            header_dict: dict[str, str] = {}
            for line in raw_req.splitlines():
                if ": " in line:
                    k, _, v = line.partition(": ")
                    header_dict[k.strip()] = v.strip()
            auth_required, auth_schemes = _auth_from_headers(header_dict)

        _upsert_endpoint(project_id, "burp", {
            "method":       method,
            "host":         host,
            "path":         path,
            "auth_required": auth_required,
            "auth_schemes": auth_schemes,
            "status_codes": [status] if status else [],
        })
        imported += 1

    events.append(project_id, "genome.burp_imported",
                  {"imported": imported, "skipped": skipped},
                  actor_type="system")
    return {"imported": imported, "skipped": skipped, "source": "burp"}


# ---------------------------------------------------------------------------
# Caido export ingest (JSON array of requests from Caido's export)
# ---------------------------------------------------------------------------

def ingest_caido(project_id: str, payload: dict | list) -> dict:
    """Parse a Caido export — either a list of flow objects or the full export JSON."""
    if isinstance(payload, dict):
        flows = payload.get("flows", payload.get("requests", payload.get("history", [])))
    else:
        flows = payload

    imported = 0
    skipped = 0
    for flow in flows:
        if not isinstance(flow, dict):
            skipped += 1
            continue

        req = flow.get("request", flow)  # Caido sometimes has request at root
        raw_url = req.get("url", req.get("raw_url", ""))
        if not raw_url:
            skipped += 1
            continue

        try:
            parsed = urlparse(raw_url)
        except Exception:
            skipped += 1
            continue

        method = (req.get("method", "GET") or "GET").upper()
        host = parsed.netloc or req.get("host", "")
        path = parsed.path or "/"

        resp = flow.get("response", {}) or {}
        status = resp.get("status_code", resp.get("status"))

        headers = req.get("headers", {}) or {}
        # Caido may give headers as dict or list of [name, value] pairs
        if isinstance(headers, list):
            headers = {h[0]: h[1] for h in headers if isinstance(h, (list, tuple)) and len(h) >= 2}
        auth_required, auth_schemes = _auth_from_headers(headers)

        resp_headers = resp.get("headers", {}) or {}
        if isinstance(resp_headers, list):
            resp_headers = {h[0]: h[1] for h in resp_headers if len(h) >= 2}
        content_types = []
        ct = resp_headers.get("content-type", resp_headers.get("Content-Type", ""))
        if ct:
            content_types = [ct.split(";")[0].strip()]

        _upsert_endpoint(project_id, "caido", {
            "method":       method,
            "host":         host,
            "path":         path,
            "auth_required": auth_required,
            "auth_schemes": auth_schemes,
            "content_types": content_types,
            "status_codes": [status] if status else [],
        })
        imported += 1

    events.append(project_id, "genome.caido_imported",
                  {"imported": imported, "skipped": skipped},
                  actor_type="system")
    return {"imported": imported, "skipped": skipped, "source": "caido"}


# ---------------------------------------------------------------------------
# Drift detection — compare OpenAPI spec vs HAR observations
# ---------------------------------------------------------------------------

def detect_drift(project_id: str) -> list[dict]:
    """Find endpoints where observed HAR data differs from the OpenAPI spec.

    Returns a list of {endpoint_id, host, path, method, flags} dicts.
    Also persists drift_flags on the endpoint rows.
    """
    spec_eps = {
        (r["method"], r["host"], r["path"]): r
        for r in db.query(
            "SELECT * FROM endpoints WHERE project_id=? AND source='openapi'",
            [project_id],
        )
    }
    har_eps = {
        (r["method"], r["host"], r["path"]): r
        for r in db.query(
            "SELECT * FROM endpoints WHERE project_id=? AND source='har'",
            [project_id],
        )
    }

    drift: list[dict] = []
    for key, har_row in har_eps.items():
        flags: list[dict[str, Any]] = []
        spec_row = spec_eps.get(key)

        if spec_row is None:
            flags.append({"type": "undocumented", "detail": "endpoint in traffic but not in spec"})
        else:
            # Auth drift
            spec_auth = int(spec_row["auth_required"])
            har_auth = int(har_row["auth_required"])
            if spec_auth and not har_auth:
                flags.append({"type": "auth_missing_in_traffic",
                               "detail": "spec declares auth required but traffic shows none"})
            elif not spec_auth and har_auth:
                flags.append({"type": "unprotected_in_spec",
                               "detail": "spec declares no auth but traffic carries credentials"})

            # Status code drift
            spec_codes = set(json.loads(spec_row.get("status_codes") or "[]"))
            har_codes = set(json.loads(har_row.get("status_codes") or "[]"))
            unexpected = har_codes - spec_codes
            if unexpected:
                flags.append({"type": "unexpected_status",
                               "detail": f"observed {sorted(unexpected)} not in spec"})

        if flags:
            db.execute("UPDATE endpoints SET drift_flags=? WHERE id=?",
                       [json.dumps(flags), har_row["id"]])
            drift.append({
                "endpoint_id": har_row["id"],
                "method":      har_row["method"],
                "host":        har_row["host"],
                "path":        har_row["path"],
                "flags":       flags,
            })

    return drift


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def get_endpoints(project_id: str, host: str | None = None,
                  source: str | None = None, with_drift: bool = False) -> list[dict]:
    q = "SELECT * FROM endpoints WHERE project_id=?"
    args: list[Any] = [project_id]
    if host:
        q += " AND host=?"
        args.append(host)
    if source:
        q += " AND source=?"
        args.append(source)
    if with_drift:
        q += " AND drift_flags != '[]'"
    q += " ORDER BY host, path, method"
    return [dict(r) for r in db.query(q, args)]


def get_summary(project_id: str) -> dict:
    rows = db.query(
        "SELECT source, COUNT(*) as n, SUM(auth_required) as auth_ct FROM endpoints "
        "WHERE project_id=? GROUP BY source",
        [project_id],
    )
    hosts = db.query(
        "SELECT DISTINCT host FROM endpoints WHERE project_id=? ORDER BY host",
        [project_id],
    )
    drift_ct = db.query_one(
        "SELECT COUNT(*) as n FROM endpoints WHERE project_id=? AND drift_flags!='[]'",
        [project_id],
    )
    return {
        "by_source":   [dict(r) for r in rows],
        "hosts":       [r["host"] for r in hosts],
        "drift_count": (drift_ct["n"] if drift_ct else 0),
    }
