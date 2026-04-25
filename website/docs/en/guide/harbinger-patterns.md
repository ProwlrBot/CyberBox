---
title: harbinger Pattern Catalog
description: Curated, schema-validated Fabric-style prompt patterns shipped with the harbinger bug-bounty pipeline.
---

# harbinger Pattern Catalog

`harbinger` is the bug-bounty pipeline orchestrator that ships with CyberBox. Beyond the classic recon → scan → report flow, it ships a Fabric-style **pattern library** of curated prompts you can pipe data into. Every pattern is reviewed, schema-constrained, and exercised by a bash test.

> **Why curated patterns?** AI-generated bug-bounty submissions overwhelmed triage queues — HackerOne reported 210% YoY growth in low-signal AI reports. The wedge is *schema-validated* output that rejects vague findings before they reach a human. Each pattern below ships with a JSON schema that **rejects low-signal output** by construction.

## Listing patterns

```bash
harbinger patterns list           # one name per line
harbinger patterns list -v        # show whether each pattern has a schema + example
harbinger pattern <name>          # run a pattern on stdin/args
```

Patterns live under `harbinger/patterns/<name>/` and contain:

| File | Purpose |
| --- | --- |
| `system.md` | The system prompt that conditions the model. |
| `schema.json` | A Draft 2020-12 JSON Schema that every output must satisfy. |
| `examples/example.input.txt` | A representative input. |
| `examples/example.output.json` | The reference output that validates against the schema. |

Run the per-pattern bash tests with:

```bash
bash harbinger/tests/test_pattern_<name>.sh
```

Each test validates the committed example against the schema (canonical pass) and best-effort invokes whichever backend (`invoke-claude` or `invoke-ollama`) is configured.

## Seed patterns (Markdown output)

These four patterns ship Markdown rather than JSON and exist mostly as templates for hand-editing reports.

| Pattern | Use case | Output shape | Validation |
| --- | --- | --- | --- |
| `analyze_vulns` | Per-request/response vulnerability analysis | Markdown with `## Finding N —` headings | manual |
| `extract_endpoints` | Pull API endpoints out of HTML/JS/responses | JSON array of `{method,path,params,auth,notes}` | manual |
| `triage_nuclei` | Triage nuclei JSONL into Submit/Investigate/Noise | Markdown table | manual |
| `write_report` | Compose a HackerOne/Bugcrowd-ready report | Markdown report skeleton | manual |

## Schema-validated patterns (new)

Each pattern below produces a single JSON object that is checked against `schema.json`. The badge column shows the test status from the most recent local run.

| Pattern | Use case | Output shape (top-level keys) | Schema-validated |
| --- | --- | --- | --- |
| [`diff_for_secrets`](#diff_for_secrets) | Scan a unified diff for leaked credentials | `{ scanned_files, findings[] }` | ![validated](https://img.shields.io/badge/schema-validated-brightgreen) |
| [`jwt_audit`](#jwt_audit) | Audit a JWT for `alg=none`, missing `exp`, sensitive claims, algorithm confusion | `{ token_id, header, claims, issues[], summary }` | ![validated](https://img.shields.io/badge/schema-validated-brightgreen) |
| [`graphql_recon`](#graphql_recon) | Surface high-value queries/mutations from an introspection dump | `{ endpoint, introspection_enabled, type_count, high_value[], auth_signals[], next_steps[] }` | ![validated](https://img.shields.io/badge/schema-validated-brightgreen) |
| [`oauth_misconfig`](#oauth_misconfig) | Audit an OAuth/OIDC flow for redirect, PKCE, scope, and state issues | `{ client_id, flow, pkce, issues[], summary }` | ![validated](https://img.shields.io/badge/schema-validated-brightgreen) |
| [`ssrf_chain`](#ssrf_chain) | Map a candidate SSRF primitive into a concrete exploit chain | `{ primitive, fetcher, egress, filters_observed[], bypass_techniques[], internal_targets[], chain[], stop_conditions[] }` | ![validated](https://img.shields.io/badge/schema-validated-brightgreen) |
| [`header_misconfig_audit`](#header_misconfig_audit) | Grade HTTP response headers (CSP, HSTS, cookies, COOP/COEP) | `{ url, status, scored, findings[], positives[] }` | ![validated](https://img.shields.io/badge/schema-validated-brightgreen) |
| [`cors_audit`](#cors_audit) | Decide whether a CORS configuration is exploitable | `{ url, credentials_supported, allowed_origins_observed[], verdict, issues[], summary }` | ![validated](https://img.shields.io/badge/schema-validated-brightgreen) |
| [`race_condition_hypotheses`](#race_condition_hypotheses) | Propose race-condition test cases for a state-changing endpoint | `{ endpoint, state_object, hypotheses[], non_targets[], summary }` | ![validated](https://img.shields.io/badge/schema-validated-brightgreen) |

---

### diff_for_secrets

**Use case.** Scan a unified diff for leaked credentials, tokens, and high-risk identifiers; classify each match by `kind` and `confidence` and reject low-confidence `other`.

**Expected output shape.**

```json
{
  "scanned_files": 2,
  "findings": [
    {
      "kind": "aws_key|aws_secret|gcp_sa|azure_key|github_token|...|other",
      "match": "<exact substring, redacted middle if > 80 chars>",
      "file": "config/production.env",
      "line": 4,
      "confidence": "high|medium|low",
      "reason": "<one sentence>",
      "entropy_bits": 84
    }
  ]
}
```

**Schema discipline.** `kind="other"` and `confidence="low"` together are rejected by the schema (`allOf.not`) — the pattern cannot return purely speculative noise.

**Run it.**

```bash
git diff main...HEAD | harbinger pattern diff_for_secrets
```

---

### jwt_audit

**Use case.** Decode a JWT (or extract one from HTTP traffic) and report misconfigurations: `alg=none`, missing/long `exp`, missing `aud`, sensitive claims, algorithm confusion, predictable `sub`.

**Expected output shape.**

```json
{
  "token_id": "<sha1[:8] of header.payload>",
  "header": { "alg": "none", "typ": "JWT" },
  "claims": { "sub": "42", "role": "admin" },
  "issues": [
    {
      "id": "alg_none|no_exp|sensitive_claim|...",
      "severity": "critical|high|medium|low|info",
      "evidence": "<exact quoted header/claim>",
      "impact": "<one sentence>",
      "fix": "<one sentence>"
    }
  ],
  "summary": "<one line>"
}
```

**Schema discipline.** Every `issue` requires non-empty `evidence` quoted from the token. `id` matches `^[a-z][a-z0-9_]{2,40}$` so models cannot smuggle prose tags.

**Run it.**

```bash
echo "Authorization: Bearer eyJhbGciOiJub25l..." | harbinger pattern jwt_audit
```

---

### graphql_recon

**Use case.** Read a GraphQL introspection result (or a `__schema` query response) and surface the top mutations/queries to attack: anything that grants roles, transfers value, or takes user IDs.

**Expected output shape.**

```json
{
  "endpoint": "https://api.example.com/graphql",
  "introspection_enabled": true,
  "type_count": 3,
  "high_value": [
    {
      "kind": "query|mutation|subscription|type|directive",
      "name": "impersonate",
      "signature": "impersonate(userId: ID): AuthPayload",
      "why": "...",
      "abuse_ideas": ["..."]
    }
  ],
  "auth_signals": ["..."],
  "next_steps": ["..."]
}
```

**Schema discipline.** Every `high_value` entry must include at least one `abuse_ideas` string. `next_steps` cannot be empty. `high_value` is capped at 12 entries — the model has to prioritise.

---

### oauth_misconfig

**Use case.** Audit an OAuth 2.0 / OIDC flow for redirect_uri abuse, PKCE absence, implicit-flow leakage, overbroad scopes, and missing `state`.

**Expected output shape.**

```json
{
  "client_id": "acme-spa",
  "flow": "authorization_code|implicit|client_credentials|password|device_code|hybrid|unknown",
  "pkce": "required|optional|absent|unknown",
  "issues": [
    {
      "id": "redirect_uri_open|redirect_uri_wildcard|pkce_missing|...",
      "severity": "critical|high|medium|low|info",
      "evidence": "<quoted from input>",
      "preconditions": ["<what an attacker needs>"],
      "exploitation": "<paragraph ending in impact>"
    }
  ],
  "summary": "<one line>"
}
```

**Schema discipline.** Each issue requires at least one item in `preconditions`. `id` is a fixed enum so models cannot invent new categories. `exploitation` has min length 16 to prevent one-word answers.

---

### ssrf_chain

**Use case.** Convert a SSRF primitive (e.g. a `?url=` parameter, a webhook callback, a preview-image renderer) into a concrete chain that reaches cloud metadata, internal admin panels, or k8s APIs.

**Expected output shape.**

```json
{
  "primitive": "<one-line description>",
  "fetcher": "browser|server|preview_image|webhook|pdf_renderer|http_client_lib|other",
  "egress": "blind|reflected|partial",
  "filters_observed": ["<exact filter quoted>"],
  "bypass_techniques": [
    { "id": "decimal_ip|dns_rebinding|...", "evidence": "...", "test_payload": "..." }
  ],
  "internal_targets": [
    { "service": "aws_imds|gcp_metadata|azure_imds|...", "url": "...", "expected_signal": "..." }
  ],
  "chain": ["step 1", "step 2", "step 3"],
  "stop_conditions": ["..."]
}
```

**Schema discipline.** Every bypass technique must include a concrete `test_payload`. Every internal target must include a concrete URL. `chain` must have at least 3 ordered steps. The schema makes a hand-wavy answer impossible.

---

### header_misconfig_audit

**Use case.** Grade HTTP response headers and call out specific weaknesses: weak CSP, short HSTS, cookie attribute gaps, COOP/COEP/CORP, verbose `Server`/`X-Powered-By` banners.

**Expected output shape.**

```json
{
  "url": "https://app.example.com/dashboard",
  "status": 200,
  "scored": "A|B|C|D|F",
  "findings": [
    {
      "header": "Content-Security-Policy",
      "id": "missing|weak|conflicting|legacy|reflective|over_permissive|debug_leak",
      "severity": "critical|high|medium|low|info",
      "observed": "<exact value or 'absent'>",
      "expected": "<one-line recommendation>",
      "rationale": "<sentence specific to THIS response>"
    }
  ],
  "positives": ["..."]
}
```

**Schema discipline.** `header` must match `^[A-Za-z][A-Za-z0-9-]{1,80}$`. `observed` has min length 1 (use `"absent"` literally for missing headers — never empty string).

---

### cors_audit

**Use case.** Decide whether a CORS configuration is exploitable. Probes for reflective ACAO, `null` origin, wildcard with credentials, regex bypasses, missing `Vary: Origin`.

**Expected output shape.**

```json
{
  "url": "https://app.example.com/api/me",
  "credentials_supported": true,
  "allowed_origins_observed": ["https://attacker.example.com", "null"],
  "verdict": "safe|risky|exploitable",
  "issues": [
    {
      "id": "reflective_origin|null_origin|wildcard_with_credentials|...",
      "severity": "critical|high|medium|low|info",
      "test_origin": "<Origin header you sent>",
      "response_acao": "<exact ACAO echoed>",
      "response_acac": "true|false|absent",
      "evidence": "<one-line quote>",
      "impact": "<one sentence>"
    }
  ],
  "summary": "<one line>"
}
```

**Schema discipline.** Every issue requires a concrete `test_origin`, the corresponding `response_acao`, and a tri-valued `response_acac`. The schema forces the model to commit to specific probes rather than speak in generalities.

---

### race_condition_hypotheses

**Use case.** For a state-changing endpoint (gift-card redemption, withdrawal, role grant, MFA enrollment), propose ranked race-condition hypotheses with concrete request pairs and observable indicators.

**Expected output shape.**

```json
{
  "endpoint": "POST https://shop.example.com/api/v1/gift-cards/redeem",
  "state_object": "<the resource holding counter/balance/quota state>",
  "hypotheses": [
    {
      "id": "gift_card_double_redeem",
      "primitive": "TOCTOU|read-modify-write|idempotency_key_replay|signup_collision|lock_skew|lazy_creation",
      "request_a": "...",
      "request_b": "<same as A> | ...",
      "expected_serial_outcome": "...",
      "expected_race_outcome": "...",
      "indicator": "<observable signal>",
      "exploit_value": "low|medium|high|critical",
      "tooling_hint": "turbo-intruder gate | http2 single-packet | ffuf -p 0 | raw curl -Z | db-trigger"
    }
  ],
  "non_targets": ["..."],
  "summary": "<one line>"
}
```

**Schema discipline.** This was the hardest pattern to constrain — race conditions are inherently speculative. The schema requires both `request_a` and `request_b` (using `"<same as A>"` for self-collisions), an observable `indicator`, an enum `tooling_hint`, and forces at least one hypothesis to reach `exploit_value >= medium` (or return `hypotheses: []` with an explanation).

## Adding a new pattern

1. Create `harbinger/patterns/<name>/system.md` with rules ending in *"Reject low-signal output"* clauses.
2. Create `harbinger/patterns/<name>/schema.json` (Draft 2020-12) with `additionalProperties: false`, enum-constrained `id` fields, and `minItems`/`minLength` constraints anywhere a model could fall back to vague output.
3. Add at least one `examples/example.input.txt` + `examples/example.output.json` pair. Validate the example against the schema.
4. Add a bash test under `harbinger/tests/test_pattern_<name>.sh` that sources `_pattern_test_helper.sh` and calls `run_pattern_test "<name>"`.
5. List the pattern in this catalog page with use case, expected output shape, and schema-discipline note.

The validation badges on this page are populated by running the tests locally — they reflect a one-time fixture-level pass. A live invocation against `invoke-claude` or `invoke-ollama` is best-effort and not part of the canonical pass criteria, since LLM determinism is out of scope.
