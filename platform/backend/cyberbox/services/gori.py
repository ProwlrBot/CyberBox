"""Gori / Caido bridge — imports proxy findings and flows into CyberBox.

Calls Caido's GraphQL API directly (stdlib urllib, no MCP protocol).
All functions return empty results gracefully when Caido is unreachable
or CYBERBOX_GORI_PAT is not set — never raise.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


def _caido_gql(query: str, variables: dict, settings) -> dict:
    """POST query to Caido GraphQL endpoint. Raises urllib.error on failure."""
    if not settings.gori_pat:
        raise PermissionError("CYBERBOX_GORI_PAT not set")
    payload = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        f"{settings.gori_url}/graphql",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.gori_pat}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read())


def get_project_info(settings) -> dict:
    """Return current Caido project name + id. Returns {} on any error."""
    q = "query { currentProject { id name } }"
    try:
        data = _caido_gql(q, {}, settings)
        proj = (data.get("data") or {}).get("currentProject") or {}
        return proj
    except PermissionError as e:
        print(f"[gori] {e}", file=sys.stderr)
        return {}
    except Exception as e:
        print(f"[gori] get_project_info failed: {e}", file=sys.stderr)
        return {}


def get_issues(settings, limit: int = 50) -> list[dict]:
    """Return Caido findings. Each item: {id, title, description, severity, request_url}"""
    q = """
    query GetFindings($limit: Int) {
      findings(first: $limit) {
        edges {
          node {
            id
            title
            description
            severity
            request {
              raw
              host
              path
              method
            }
          }
        }
      }
    }
    """
    try:
        data = _caido_gql(q, {"limit": limit}, settings)
        edges = ((data.get("data") or {}).get("findings") or {}).get("edges") or []
        results = []
        for edge in edges:
            node = edge.get("node") or {}
            req = node.get("request") or {}
            results.append({
                "id": node.get("id", ""),
                "title": node.get("title", ""),
                "description": node.get("description", ""),
                "severity": node.get("severity", "unknown"),
                "request_url": f"https://{req.get('host','')}{req.get('path','')}",
                "method": req.get("method", "GET"),
            })
        return results
    except PermissionError as e:
        print(f"[gori] {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"[gori] get_issues failed: {e}", file=sys.stderr)
        return []


def get_recent_flows(settings, limit: int = 100, host_filter: str | None = None) -> list[dict]:
    """Return recent HTTP flows from Caido proxy history.
    Each: {id, method, host, path, status, size}
    """
    q = """
    query GetRequests($limit: Int, $filter: HTTPQL) {
      requests(first: $limit, filter: $filter) {
        edges {
          node {
            id
            method
            host
            path
            response {
              statusCode
              length
            }
          }
        }
      }
    }
    """
    variables: dict = {"limit": limit}
    if host_filter:
        variables["filter"] = f'host: "{host_filter}"'
    try:
        data = _caido_gql(q, variables, settings)
        edges = ((data.get("data") or {}).get("requests") or {}).get("edges") or []
        results = []
        for edge in edges:
            node = edge.get("node") or {}
            resp = node.get("response") or {}
            results.append({
                "id": node.get("id", ""),
                "method": node.get("method", ""),
                "host": node.get("host", ""),
                "path": node.get("path", ""),
                "status": resp.get("statusCode"),
                "size": resp.get("length"),
            })
        return results
    except PermissionError as e:
        print(f"[gori] {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"[gori] get_recent_flows failed: {e}", file=sys.stderr)
        return []
