#!/usr/bin/env bash
# Tests for `prowl doctor` — schema validation suppression reporter.
# Run: bash prowl/tests/test_prowl_doctor.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROWL_BIN_DIR="${SCRIPT_DIR}/../bin"
PROWL="${PROWL_BIN_DIR}/prowl"
VALIDATE_SCHEMA="${PROWL_BIN_DIR}/validate-schema"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

# Use a temp PROWL_DIR so we don't touch ~/.prowl
export PROWL_DIR="$(mktemp -d)"
export PROWL_RUNS_DIR="${PROWL_DIR}/runs"
trap 'rm -rf "$PROWL_DIR"' EXIT

# Force NO_COLOR so the output is greppable without ANSI escape noise.
export NO_COLOR=1

echo "=== prowl doctor tests ==="

# ────────────────────────────────────────────────────────────────
# Test 1: validate-schema standalone — valid input
# ────────────────────────────────────────────────────────────────
echo "[1] validate-schema accepts valid jwt_audit JSON"
valid_json='{"token_id":"abc123","header":{"alg":"HS256"},"claims":{},"summary":"ok summary","issues":[]}'
schema="${SCRIPT_DIR}/../patterns/jwt_audit/schema.json"

if printf '%s' "$valid_json" | "$VALIDATE_SCHEMA" "$schema" 2>/dev/null; then
  pass "valid JSON exits 0"
else
  fail "valid JSON should exit 0; got $?"
fi

# ────────────────────────────────────────────────────────────────
# Test 2: validate-schema standalone — missing required field
# ────────────────────────────────────────────────────────────────
echo "[2] validate-schema rejects missing required field"
invalid_json='{"token_id":"abc123","header":{"alg":"HS256"},"claims":{}}'
err=$(printf '%s' "$invalid_json" | "$VALIDATE_SCHEMA" "$schema" 2>&1 >/dev/null) && rc=0 || rc=$?

if [[ "$rc" -eq 1 ]]; then
  pass "missing-field exits 1"
else
  fail "missing-field should exit 1; got $rc"
fi

if echo "$err" | jq -e '.error_class == "missing_field"' >/dev/null 2>&1; then
  pass "missing-field error_class = missing_field"
else
  fail "missing-field error_class wrong: $err"
fi

# ────────────────────────────────────────────────────────────────
# Test 3: doctor lists no runs when runs dir is empty
# ────────────────────────────────────────────────────────────────
echo "[3] doctor reports no runs on empty runs dir"
out=$("$PROWL" doctor 2>&1) && rc=0 || rc=$?
if [[ "$rc" -eq 0 ]]; then
  pass "doctor exits 0 on empty"
else
  fail "doctor should exit 0 on empty; got $rc"
fi

if echo "$out" | grep -qiE 'no runs|no runs yet'; then
  pass "doctor message indicates no runs"
else
  fail "doctor output didn't indicate empty state: $out"
fi

# ────────────────────────────────────────────────────────────────
# Test 4: fabricate a synthetic run + suppression, then doctor it
# ────────────────────────────────────────────────────────────────
echo "[4] doctor reads synthetic suppression (the spec's headline ask)"
RUN_ID="20260425T012345Z-jwt_audit"
RUN_DIR="${PROWL_RUNS_DIR}/${RUN_ID}"
mkdir -p "$RUN_DIR"
cat > "${RUN_DIR}/meta.json" <<META
{"pattern":"jwt_audit","started_at":"2026-04-25T01:23:45Z"}
META

# Suppression line: missing 'issues' field, simulating an AI output the
# schema would reject.
cat > "${RUN_DIR}/suppression.jsonl" <<'SUPPRESSION'
{"ts":"2026-04-25T01:23:45Z","pattern":"jwt_audit","raw_output":"{\"token_id\":\"abc123\",\"header\":{\"alg\":\"HS256\"},\"claims\":{}}","detail":{"error_class":"missing_field","message":"'issues' is a required property","path":[],"validator":"required","schema_id":"jwt_audit","additional_error_count":1}}
SUPPRESSION

# 4a: list mode shows the run
out=$("$PROWL" doctor 2>&1) || true
if echo "$out" | grep -q "$RUN_ID"; then
  pass "doctor list mode shows synthetic run"
else
  fail "doctor list did not show $RUN_ID: $out"
fi

# 4b: detail mode shows the error class and raw output
out=$("$PROWL" doctor "$RUN_ID" 2>&1) || true

if echo "$out" | grep -q 'missing_field'; then
  pass "doctor details mention missing_field error class"
else
  fail "doctor details missing error_class: $out"
fi

if echo "$out" | grep -q "'issues' is a required property"; then
  pass "doctor details show validator message"
else
  fail "doctor details did not show validator message: $out"
fi

if echo "$out" | grep -q 'token_id'; then
  pass "doctor details include the raw output"
else
  fail "doctor details missing raw output: $out"
fi

# 4c: 'latest' resolves to the most recent run
out=$("$PROWL" doctor latest 2>&1) || true
if echo "$out" | grep -q "$RUN_ID"; then
  pass "doctor latest resolves to most recent run"
else
  fail "doctor latest did not resolve correctly: $out"
fi

# ────────────────────────────────────────────────────────────────
# Test 5: doctor on a nonexistent run-id fails clearly
# ────────────────────────────────────────────────────────────────
echo "[5] doctor on nonexistent run-id exits 1 with clear message"
out=$("$PROWL" doctor "no-such-run-id-xyz" 2>&1) && rc=0 || rc=$?
if [[ "$rc" -ne 0 ]]; then
  pass "doctor exits non-zero on nonexistent run"
else
  fail "doctor should fail on nonexistent run; got $rc"
fi

if echo "$out" | grep -qi 'not found'; then
  pass "error message mentions 'not found'"
else
  fail "error message unclear: $out"
fi

# ────────────────────────────────────────────────────────────────
# Test 6: empty suppression file — clean run reports zero
# ────────────────────────────────────────────────────────────────
echo "[6] doctor reports zero for a clean run (empty suppression.jsonl)"
CLEAN_RUN_ID="20260425T013000Z-cors_audit"
CLEAN_DIR="${PROWL_RUNS_DIR}/${CLEAN_RUN_ID}"
mkdir -p "$CLEAN_DIR"
: > "${CLEAN_DIR}/suppression.jsonl"

out=$("$PROWL" doctor "$CLEAN_RUN_ID" 2>&1) && rc=0 || rc=$?
if [[ "$rc" -eq 0 ]]; then
  pass "clean run exits 0"
else
  fail "clean run should exit 0; got $rc"
fi

if echo "$out" | grep -q '0 suppressions'; then
  pass "clean run message mentions 0 suppressions"
else
  fail "clean run output unexpected: $out"
fi

echo
echo "=== summary: ${PASS} passed, ${FAIL} failed ==="
[[ "$FAIL" -eq 0 ]]
