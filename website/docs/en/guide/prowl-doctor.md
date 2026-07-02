---
title: Prowl doctor
description: Audit which AI outputs were rejected by the schema validator, why, and whether the pattern or the model is at fault.
---

# Prowl doctor

`prowl doctor` makes the schema validator auditable. When you run a pattern with a `schema.json`, every AI output gets validated; outputs that fail validation are *recorded* — never silently lost — into a per-run suppression log. `prowl doctor` reads that log so you can see exactly what got rejected and why.

> **Why this exists.** The default behaviour of [schema-validated patterns](prowl-patterns) is to reject low-signal AI output before it reaches a finding. That's a useful default, but it turns the validator into a black box: when a hunter expected a finding to land and it didn't, there is no recourse. `doctor` is the recourse.

## Two modes

```bash
prowl doctor            # list mode: 20 most recent runs + suppression counts
prowl doctor <run-id>   # detail mode: every suppression in that run
prowl doctor latest     # detail mode for the most recent run by mtime
```

A run-id has the form `<UTC ISO compact>-<pattern>`, e.g. `20260425T012345Z-jwt_audit`. One run-id is generated per `run_pattern` invocation.

### List mode

```text
$ prowl doctor

Recent prowl runs (most recent first):

  20260425T021015Z-jwt_audit         3 suppression(s)
  20260425T015523Z-cors_audit        0 suppression(s)
  20260425T014401Z-ssrf_chain        1 suppression(s)
  ...

View details with: prowl doctor <run-id>   (or 'latest')
```

A `0 suppression(s)` line means every AI output that round validated cleanly. A non-zero count is your cue to inspect.

### Detail mode

```text
$ prowl doctor 20260425T021015Z-jwt_audit

=== prowl doctor — run 20260425T021015Z-jwt_audit ===
Suppressions: 3

Grouped by error class:
  2 missing_field
  1 regex_mismatch

Details:
--------
[2026-04-25T02:10:17Z] pattern=jwt_audit
  error_class : missing_field
  message     : 'issues' is a required property
  json_path   : []
  validator   : required
  raw output  :
    {"token_id":"abc123","header":{"alg":"HS256"},"claims":{}}

[2026-04-25T02:10:18Z] pattern=jwt_audit
  error_class : regex_mismatch
  message     : 'JOSE-fmt' does not match '^(HS|RS|ES|PS)(256|384|512)$|^none$'
  json_path   : ['header','alg']
  validator   : pattern
  raw output  :
    {"token_id":"def456","header":{"alg":"JOSE-fmt"},...}
```

Each suppression block reports: timestamp, pattern that was running, the validator's `error_class` (a human-friendly category name), the `message` from `jsonschema`, the JSON pointer to the offending value, the `validator` keyword that fired, and the raw AI output verbatim.

If the same output had multiple errors, only the first is detailed and the suppression block notes `(N more errors in same output)`. The first error is almost always the high-signal one — a missing required field cascades into many secondary type errors.

## Error class catalog

`error_class` is the validator's verdict in human-readable form. The most common categories:

| `error_class` | What it means | Typical fix |
|---|---|---|
| `missing_field` | A `required` property was absent. | Either tighten the system prompt to demand the field, or relax the schema if the field is genuinely optional. |
| `wrong_type` | The model returned a string where a number was expected (or similar). | Usually the prompt — show the model the right type with an example. |
| `regex_mismatch` | A string failed a `pattern` check. Common for IDs, severities, model names. | Check the regex; the model often returns close-but-wrong values like `"high "` (trailing space) or `"HIGH"` (case). |
| `enum_violation` | A value wasn't in the allowed `enum`. | Same as regex_mismatch — the prompt should enumerate the allowed values inline. |
| `extra_field` | The model invented a property the schema marks `additionalProperties: false`. | Either add the field to the schema if it's useful, or warn the model in the prompt to stick to listed fields. |
| `format_violation` | A `format` constraint failed (`uri`, `email`, `date-time`, ...). | Often a malformed timestamp; ask the model to use ISO 8601. |
| `too_short` / `too_long` | `minLength` / `maxLength` violated. | Adjust prompt to demand a target length, or relax the bound. |
| `too_few_items` / `too_many_items` | `minItems` / `maxItems` violated on an array. | The model returned `[]` when the schema said "at least one." Either prompt for examples or relax to `minItems: 0`. |
| `too_few_properties` / `too_many_properties` | `minProperties` / `maxProperties` violated on an object. | Rare; usually a generic-record schema is too strict. |
| `below_minimum` / `above_maximum` | Numeric bounds violated. | The model returned a confidence of `1.5` on a `[0,1]` scale, etc. |
| `wrong_const` | A `const` discriminator didn't match. | Schema is checking a tag/version field; align the prompt to set it. |

The full enum is defined at [`prowl/bin/validate-schema`](https://github.com/ProwlrBot/CyberBox/blob/main/prowl/bin/validate-schema) and is canonical.

## Decision tree: is my pattern too strict, or is the model noisy?

When a suppression count is non-zero, you have three levers: the **prompt**, the **schema**, and the **model**. Use the suppression detail to pick:

1. **Read the raw output.** Is it nonsense, off-topic, or hallucinated? → **Model issue.** Rerun with a higher-tier model (`prowl pattern <name>` already routes JSON-shaped patterns to Claude Sonnet / Opus, but you can override at the `ai` call site).
2. **Read the raw output and the schema together.** Does the model's structure look reasonable but a field name or value is *almost* right (`"highh"` → `"high"`, `1.5` → `1.0`, missing one field)? → **Prompt issue.** Tighten the system prompt: enumerate the allowed values, show an example output, demand the missing field by name.
3. **Read the raw output, the schema, and the example.** Is the schema demanding a field the example doesn't even have, or rejecting a value the example would also reject? → **Schema issue.** The schema has drifted from the intent. Compare against `prowl/patterns/<name>/examples/example.output.json` — that example MUST validate against the schema (the test suite enforces this).

A useful heuristic: if more than ~30% of a real-world run is suppressed, the schema or prompt is probably wrong, not the model. If less than ~5% is suppressed, the suppressions are usually genuine low-signal noise that the validator caught — exactly the value proposition.

## Where suppression logs live

```
${PROWL_DIR:-~/.prowl}/runs/<run-id>/
├── meta.json              # {pattern, started_at}
└── suppression.jsonl      # one JSONL record per rejection
```

Each JSONL record has the shape:

```json
{
  "ts": "2026-04-25T02:10:17Z",
  "pattern": "jwt_audit",
  "raw_output": "...",
  "detail": {
    "error_class": "missing_field",
    "message": "'issues' is a required property",
    "path": [],
    "validator": "required",
    "schema_id": "jwt_audit",
    "additional_error_count": 0
  }
}
```

The log is append-only. Patterns without a `schema.json` bypass validation entirely and produce no suppression log.

## Troubleshooting

- **`No runs found under ...`** — you haven't run a schema-validated pattern yet. Try `prowl pattern jwt_audit < some_token.txt` to populate one.
- **`run not found: <id>`** — the run-id you passed doesn't exist as a directory under `${PROWL_DIR}/runs/`. Use list mode (`prowl doctor` with no arg) to find the right id, or pass `latest`.
- **`0 suppressions (everything passed validation)`** — the run completed and every output was schema-valid. This is the success case; nothing to investigate.

## Related

- [prowl Pattern Catalog](prowl-patterns) — the schemas that drive validation
- [`prowl/bin/validate-schema`](https://github.com/ProwlrBot/CyberBox/blob/main/prowl/bin/validate-schema) — the Python helper that emits the structured `error_class` values
- [Supply-chain trust](trust) — same trust story as the rest of the prowl pipeline
