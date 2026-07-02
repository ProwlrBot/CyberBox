"""Seed reference catalogs and built-in detection templates. No mock data."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from . import db
from .config import get_settings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


INTEGRATION_CATALOG = [
    ("jira", "Jira", "apikey"), ("gitlab", "GitLab", "oauth"), ("github", "GitHub", "oauth"),
    ("slack", "Slack", "oauth"), ("msteams", "Microsoft Teams", "oauth"),
    ("email", "Email (SMTP)", "apikey"), ("webhook", "Custom Webhook", "apikey"),
    ("aws", "AWS", "apikey"), ("azure", "Azure", "apikey"), ("gcp", "GCP", "apikey"),
    ("cloudflare", "Cloudflare", "apikey"), ("digitalocean", "DigitalOcean", "apikey"),
    ("kubernetes", "Kubernetes", "apikey"),
]

BUILTIN_TEMPLATES = [
    {"template_id": "exposed-docker-api", "name": "Exposed Docker Engine API",
     "category": "Exposed Docker & K8s", "severity": "critical", "tags": ["docker", "exposure", "rce"],
     "yaml": "id: exposed-docker-api\ninfo:\n  name: Exposed Docker Engine API\n  severity: critical\nrequests:\n  - method: GET\n    path: [\"{{BaseURL}}/version\"]\n    matchers:\n      - type: word\n        part: body\n        words: [\"ApiVersion\"]\n"},
    {"template_id": "exposed-kubernetes-api", "name": "Unauthenticated Kubernetes API Server",
     "category": "Exposed Docker & K8s", "severity": "critical", "tags": ["kubernetes", "exposure"],
     "yaml": "id: exposed-kubernetes-api\ninfo:\n  name: Unauthenticated Kubernetes API\n  severity: critical\nrequests:\n  - method: GET\n    path: [\"{{BaseURL}}/api/v1/namespaces\"]\n    matchers:\n      - type: word\n        part: body\n        words: [\"NamespaceList\"]\n"},
    {"template_id": "cloud-metadata-ssrf", "name": "Cloud Metadata Endpoint Reachable",
     "category": "Cloud Metadata Endpoints", "severity": "high", "tags": ["ssrf", "cloud", "imds"],
     "yaml": "id: cloud-metadata-ssrf\ninfo:\n  name: Cloud Metadata Endpoint Reachable\n  severity: high\nrequests:\n  - method: GET\n    path: [\"{{BaseURL}}/latest/meta-data/iam/security-credentials/\"]\n    matchers:\n      - type: regex\n        part: body\n        regex: [\"AccessKeyId\"]\n"},
    {"template_id": "aws-keys-exposure", "name": "AWS Access Keys Exposed",
     "category": "AWS Keys Exposure", "severity": "high", "tags": ["aws", "secrets"],
     "yaml": "id: aws-keys-exposure\ninfo:\n  name: AWS Access Keys Exposed\n  severity: high\nrequests:\n  - method: GET\n    path: [\"{{BaseURL}}\"]\n    matchers:\n      - type: regex\n        part: body\n        regex: [\"AKIA[0-9A-Z]{16}\"]\n"},
    {"template_id": "unauth-config-secrets", "name": "Unauthenticated Secrets Exposure",
     "category": "Secrets Exposure", "severity": "critical", "tags": ["secrets", "exposure"],
     "yaml": "id: unauth-config-secrets\ninfo:\n  name: Unauthenticated Secrets Exposure\n  severity: critical\nrequests:\n  - method: GET\n    path: [\"{{BaseURL}}/.env\", \"{{BaseURL}}/actuator/env\", \"{{BaseURL}}/config.json\"]\n    matchers:\n      - type: regex\n        part: body\n        regex: [\"(?i)(secret|password|api_key)\\\\s*[=:]\"] \n"},
    {"template_id": "open-redirect", "name": "Open Redirect",
     "category": "Open Redirect", "severity": "medium", "tags": ["redirect"],
     "yaml": "id: open-redirect\ninfo:\n  name: Open Redirect\n  severity: medium\nrequests:\n  - method: GET\n    path: [\"{{BaseURL}}/redirect?url=https://example.org\"]\n    matchers:\n      - type: regex\n        part: header\n        regex: [\"Location:\\\\s*https?://example\\\\.org\"]\n"},
    {"template_id": "idor-sequential-id", "name": "Unauthenticated IDOR via Sequential IDs",
     "category": "Broken Access Control", "severity": "high", "tags": ["idor", "bac"],
     "yaml": "id: idor-sequential-id\ninfo:\n  name: Unauthenticated IDOR\n  severity: high\nrequests:\n  - method: GET\n    path: [\"{{BaseURL}}/api/objects/1\", \"{{BaseURL}}/api/objects/2\"]\n    matchers:\n      - type: status\n        status: [200]\n"},
]


def seed() -> None:
    settings = get_settings()
    now = _now()
    for severity, days in settings.sla_defaults.items():
        db.upsert("sla_policy", {"severity": severity, "days": days},
                  conflict_cols=["severity"], update_cols=["days"])
    for itype, name, auth_kind in INTEGRATION_CATALOG:
        if db.query_one("SELECT id FROM integrations WHERE type=?", [itype]):
            continue
        db.insert("integrations", {"id": str(uuid.uuid4()), "type": itype, "name": name,
                                    "status": "available", "auth_kind": auth_kind,
                                    "config": "{}", "created_at": now})
    for t in BUILTIN_TEMPLATES:
        db.upsert("templates",
                  {"id": str(uuid.uuid4()), "template_id": t["template_id"], "name": t["name"],
                   "category": t["category"], "severity": t["severity"], "source": "builtin",
                   "yaml": t["yaml"], "tags": json.dumps(t["tags"]), "created_at": now},
                  conflict_cols=["template_id"],
                  update_cols=["name", "category", "severity", "yaml", "tags"])
