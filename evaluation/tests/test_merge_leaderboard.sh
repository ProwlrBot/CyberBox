#!/usr/bin/env bash
# Smoke tests for evaluation/merge_leaderboard.py (spec 014, phase 7-3).
#
# Self-contained: no live MCP, no live model. Just synthetic sidecars
# crafted to exercise every code path in the merger:
#   1. Paired sidecars → 1 merged row with upstream populated
#   2. Upstream-only → 0 rows + [skip] message on stderr
#   3. Cybersandbox-only → 1 row with upstream:null
#   4. Schema-invalid sidecar → non-zero exit, no output corruption
#   5. Empty result tree → 0 rows, exit 0
#
# Run:
#     bash evaluation/tests/test_merge_leaderboard.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVAL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MERGER="${EVAL_DIR}/merge_leaderboard.py"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# Helper: write a synthetic sidecar to a path. Args:
#   $1 = path
#   $2 = pass_rate (0.0..1.0; supply 1.5 to deliberately fail the schema)
#   $3 = tool_calls
write_sidecar() {
  local path="$1"
  local pr="$2"
  local tc="$3"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<EOF
{
  "id": "20260425-eval_demo",
  "config_ref": "evaluation/configs/langgraph_ping.toml",
  "eval_file": "evaluation/dataset/evaluation_ping.xml",
  "release_tag": null,
  "run_timestamp_utc": "2026-04-25T05:00:00Z",
  "harness_version": "0.1.0",
  "runtime": "langgraph",
  "cyberbox": {
    "pass_rate": ${pr}, "total_tasks": 1, "passed_tasks": 1,
    "latency_ms_p50": 3430.0, "latency_ms_p95": null,
    "latency_ms_mean": 3430.0, "tool_calls": ${tc},
    "cost_usd": null, "token_input": null, "token_output": null
  },
  "upstream": null
}
EOF
}

echo "=== merge_leaderboard.py smoke tests ==="

# --------------------------------------------------------------------------
# Test 1: paired cybersandbox + upstream → 1 merged row
# --------------------------------------------------------------------------
echo "[1] paired cybersandbox + upstream → 1 merged row, upstream populated"
write_sidecar "$TMPDIR/in/20260425/eval_demo.json"           "1.0" "5"
write_sidecar "$TMPDIR/in/20260425/upstream/eval_demo.json"  "0.0" "8"

python3 "$MERGER" --in "$TMPDIR/in" --out "$TMPDIR/out/leaderboard.json" >/dev/null 2>&1
rc=$?
if [[ $rc -eq 0 ]]; then
  pass "merger exits 0 on paired input"
else
  fail "merger should exit 0; got $rc"
fi

if python3 -c "
import json
data = json.load(open('$TMPDIR/out/leaderboard.json'))
assert len(data['rows']) == 1, f'expected 1 row, got {len(data[\"rows\"])}'
row = data['rows'][0]
assert row['cyberbox']['pass_rate'] == 1.0
assert row['upstream'] is not None
assert row['upstream']['pass_rate'] == 0.0
assert row['upstream']['tool_calls'] == 8
" >/dev/null 2>&1; then
  pass "row has cyberbox pass=1.0 + upstream pass=0.0 + upstream tool_calls=8"
else
  fail "merged row content wrong"
fi

# --------------------------------------------------------------------------
# Test 2: upstream-only → 0 rows + [skip] message
# --------------------------------------------------------------------------
echo "[2] upstream-only → 0 rows + [skip] message"
rm -rf "$TMPDIR/in" "$TMPDIR/out"
write_sidecar "$TMPDIR/in/20260425/upstream/eval_demo.json" "0.5" "3"

stderr=$(python3 "$MERGER" --in "$TMPDIR/in" --out "$TMPDIR/out/leaderboard.json" 2>&1)
if echo "$stderr" | grep -q '\[skip\]'; then
  pass "[skip] message emitted for upstream-only"
else
  fail "expected [skip]; got: $stderr"
fi

if python3 -c "
import json
data = json.load(open('$TMPDIR/out/leaderboard.json'))
assert data['rows'] == [], f'expected 0 rows, got {len(data[\"rows\"])}'
" >/dev/null 2>&1; then
  pass "0 rows in output"
else
  fail "expected 0 rows"
fi

# --------------------------------------------------------------------------
# Test 3: cybersandbox-only → 1 row with upstream:null
# --------------------------------------------------------------------------
echo "[3] cybersandbox-only → 1 row, upstream:null"
rm -rf "$TMPDIR/in" "$TMPDIR/out"
write_sidecar "$TMPDIR/in/20260425/eval_demo.json" "1.0" "5"

python3 "$MERGER" --in "$TMPDIR/in" --out "$TMPDIR/out/leaderboard.json" >/dev/null 2>&1
rc=$?
if [[ $rc -eq 0 ]]; then
  pass "merger exits 0"
else
  fail "merger should exit 0 with cybersandbox-only; got $rc"
fi

if python3 -c "
import json
data = json.load(open('$TMPDIR/out/leaderboard.json'))
assert len(data['rows']) == 1
assert data['rows'][0]['upstream'] is None
" >/dev/null 2>&1; then
  pass "1 row with upstream=null"
else
  fail "expected 1 row with upstream=null"
fi

# --------------------------------------------------------------------------
# Test 4: schema-invalid sidecar (pass_rate > 1) → non-zero exit
# --------------------------------------------------------------------------
echo "[4] schema-invalid sidecar (pass_rate=1.5) → non-zero exit"
rm -rf "$TMPDIR/in" "$TMPDIR/out"
write_sidecar "$TMPDIR/in/20260425/eval_demo.json" "1.5" "5"

if python3 "$MERGER" --in "$TMPDIR/in" --out "$TMPDIR/out/leaderboard.json" >/dev/null 2>&1; then
  fail "merger exited 0 on schema-invalid row (should have failed)"
else
  pass "merger exits non-zero on schema violation"
fi

# --------------------------------------------------------------------------
# Test 5: empty result tree → 0 rows, exit 0
# --------------------------------------------------------------------------
echo "[5] empty result tree → 0 rows, exit 0"
rm -rf "$TMPDIR/in" "$TMPDIR/out"
mkdir -p "$TMPDIR/in"

python3 "$MERGER" --in "$TMPDIR/in" --out "$TMPDIR/out/leaderboard.json" >/dev/null 2>&1
rc=$?
if [[ $rc -eq 0 ]]; then
  pass "empty in_root exits 0"
else
  fail "empty in_root should exit 0; got $rc"
fi

if python3 -c "
import json
data = json.load(open('$TMPDIR/out/leaderboard.json'))
assert data['rows'] == []
" >/dev/null 2>&1; then
  pass "0 rows for empty in_root"
else
  fail "empty in_root should produce empty rows"
fi

echo ""
echo "=== summary: ${PASS} passed, ${FAIL} failed ==="
[[ "$FAIL" -eq 0 ]]
