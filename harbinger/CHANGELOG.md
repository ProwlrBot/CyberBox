# Changelog

## Unreleased

### Added
- **NemoClaw-style guardrails for AI calls** (spec 005). Ports the 7 prompt-injection patterns and 6 secret-redaction classes from the Caido plugin backend (`caido-plugin/packages/backend/src/index.ts` §"NemoClaw-style Guardrails") to a new Python helper `harbinger/bin/harbinger-guardrails` with two modes: `filter` (stdin → sanitized stdout, exit 2 on flag, structured JSON match log on stderr) and `redact` (stdin → stdout with secrets replaced). The orchestrator wires this into four AI sites:
  - `phase_recon` — filters live_hosts.json before triage prompt; redacts triage.md output.
  - `phase_analyze` — filters arbitrary user input; redacts AI output before terminal display.
  - `phase_validate` — filters nuclei `description` and `curl-command` strings before they reach Claude. **Does not redact** the AI output (PoC payloads may legitimately reference test-shaped tokens; redaction would corrupt machine-replay manifests).
  - `run_pattern` — filters all pattern input; redacts output **except** for `diff_for_secrets`, whose explicit purpose is to surface leaked credentials.
  Off-switch: `HARBINGER_GUARDRAILS=off` bypasses both modes (passthrough). Flagged events are appended to `${HARBINGER_DIR}/logs/guardrails.jsonl` with `{ts, phase, flagged, matches:[{pattern,count}]}` for future audit tooling. Pattern names (`ignore_previous`, `disregard_system`, `dan_jailbreak`, `system_prompt_marker`, `im_start_end`, `system_bracket`, `fenced_system_prompt`) are stable identifiers — kept snake_case so log filtering is durable across releases.
- **`harbinger/tests/test_guardrails.sh`** with 21 assertions: OWASP-LLM-Top-10 attack corpus (one payload per pattern), 6 secret-class redactions, off-switch passthrough (filter + redact), benign-content rc=0, integration via `harbinger analyze` (stub-Claude verifies sentinel reaches AI, raw injection does not), audit-log structure, off-switch propagation through the orchestrator, and AI-output redaction across 4 secret classes. Wired into `test_harbinger.sh` as test [10].

- **`harbinger doctor [run-id]` subcommand** for auditing schema-suppressed AI outputs (spec 017, commit b6f1e7d). Two modes: list (no arg or `latest` for a quick overview of recent runs and their suppression counts) and detail (`<run-id>` or `latest` to show every rejection's raw output, validator error class, JSON pointer, and message). Per-run suppression logs land at `${HARBINGER_DIR}/runs/<run-id>/suppression.jsonl`. Run-id format: `<UTC ISO compact>-<pattern>` (e.g. `20260425T012345Z-jwt_audit`). User-facing docs: [`website/docs/en/guide/harbinger-doctor.md`](../website/docs/en/guide/harbinger-doctor.md).
- **`harbinger/bin/validate-schema`** Python helper (spec 017). Reads JSON on stdin and a Draft 2020-12 schema path from argv; on validation failure emits a single structured JSON line on stderr with `error_class` mapped from the `jsonschema` validator keyword (e.g. `required` → `missing_field`, `pattern` → `regex_mismatch`, `additionalProperties` → `extra_field`). Exit codes: 0 valid, 1 invalid, 2 usage/schema-not-found.
- **`run_pattern` schema validation hook** (spec 017). When `harbinger/patterns/<name>/schema.json` exists, the AI output is validated and any rejection is appended to the run's `suppression.jsonl`. Default behaviour is observe-not-suppress: the raw output still passes through to stdout so existing callers are unchanged. A future strict-mode flag is the natural Phase 2.
- **`harbinger/tests/test_harbinger_doctor.sh`** with 14 assertions covering `validate-schema` (valid + missing-field), `doctor` empty state, synthetic suppression detail (error class + validator message + raw output), `latest` alias, nonexistent run-id, and clean-run zero-suppression report. Wired into the main `test_harbinger.sh` runner.
- **`jsonschema>=4.18,<5.0`** added to `harbinger/pyproject.toml` for Draft 2020-12 support.

### Notes
- Patterns without a `schema.json` bypass validation entirely — preserves backward compatibility for unmigrated patterns.
- The 8 patterns under `harbinger/patterns/*/schema.json` (jwt_audit, cors_audit, oauth_misconfig, ssrf_chain, header_misconfig_audit, race_condition_hypotheses, graphql_recon, diff_for_secrets) shipped Draft 2020-12 schemas in spec 006 and are now validation-active.
