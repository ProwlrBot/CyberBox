#!/usr/bin/env bash
# Tests for csbx plugin manager
# Run: bash harbinger/tests/test_csbx.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CSBX="${SCRIPT_DIR}/../bin/csbx"
PASS=0
FAIL=0

# Use a temp home so we don't touch the real one
export CSBX_HOME="$(mktemp -d)"
trap 'rm -rf "$CSBX_HOME"' EXIT

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

echo "=== csbx tests ==="

# Test: help output
echo "[1] help text"
if "$CSBX" help 2>&1 | grep -qi "commands\|usage\|csbx"; then
  pass "help shows usage"
else
  fail "help should show commands"
fi

# Test: ensure_dirs creates structure
echo "[2] directory init"
"$CSBX" doctor &>/dev/null || true
if [[ -d "$CSBX_HOME/plugins/tools" && -d "$CSBX_HOME/plugins/wordlists" && -d "$CSBX_HOME/bin" ]]; then
  pass "directories created"
else
  fail "expected plugins/tools, plugins/wordlists, bin dirs"
fi

# Test: installed.yaml created
echo "[3] installed.yaml bootstrap"
if [[ -f "$CSBX_HOME/installed.yaml" ]]; then
  pass "installed.yaml exists"
else
  fail "installed.yaml should be created on first run"
fi

# Test: list with nothing installed
echo "[4] list empty"
output=$("$CSBX" list 2>&1) || true
if echo "$output" | grep -qi "no plugins\|installed plugins"; then
  pass "list handles empty state"
else
  fail "list should show empty message, got: $output"
fi

# Test: search without registry
echo "[5] search without sync"
output=$("$CSBX" search fuzzing 2>&1) || true
if echo "$output" | grep -qi "sync\|registry\|no\|fuzzing"; then
  pass "search gives feedback without registry"
else
  fail "search should indicate missing registry, got: $output"
fi

# Test: info for nonexistent plugin
echo "[6] info nonexistent"
output=$("$CSBX" info fakeplugin123 2>&1) || true
if [[ $? -ne 0 ]] || echo "$output" | grep -qi "not found\|unknown\|no\|sync"; then
  pass "info rejects unknown plugin"
else
  fail "info should reject unknown plugin"
fi

# Test: remove nonexistent plugin
echo "[7] remove nonexistent"
output=$("$CSBX" remove fakeplugin123 2>&1) || true
if echo "$output" | grep -qi "not installed\|not found\|no"; then
  pass "remove handles missing plugin"
else
  fail "remove should report not installed"
fi

# Test: doctor runs without error
echo "[8] doctor"
if "$CSBX" doctor 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -qi "Health\|plugin\|installed\|available"; then
  pass "doctor runs"
else
  fail "doctor should produce output"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
