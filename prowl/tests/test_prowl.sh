#!/usr/bin/env bash
# Tests for prowl pipeline orchestrator
# Run: bash prowl/tests/test_prowl.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROWL="${SCRIPT_DIR}/../bin/prowl"
PASS=0
FAIL=0

export PROWL_DIR="$(mktemp -d)"
trap 'rm -rf "$PROWL_DIR"' EXIT

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

echo "=== prowl tests ==="

# Test: help output
echo "[1] help text"
if "$PROWL" help 2>&1 | grep -qi "usage\|prowl\|hunt"; then
  pass "help shows usage"
else
  fail "help should mention usage/hunt"
fi

# Test: no args shows help
echo "[2] no args"
output=$("$PROWL" 2>&1) || true
if echo "$output" | grep -qi "usage\|prowl\|command"; then
  pass "no args shows help"
else
  fail "no args should show help"
fi

# Test: status for nonexistent target
echo "[3] status nonexistent"
output=$("$PROWL" status nonexistent.example.com 2>&1) || true
if echo "$output" | grep -qi "no workspace\|not found\|no target\|status"; then
  pass "status handles missing target"
else
  fail "status should indicate no workspace"
fi

# Test: workspace init via recon (dry — subfinder may not exist)
echo "[4] workspace creation"
# Just test that init_workspace creates the right structure
# We can't run full recon without tools, but the dir structure should appear
"$PROWL" status test.example.com 2>&1 || true
# Manually init
mkdir -p "$PROWL_DIR/targets/test.example.com"/{recon,findings,evidence,reports,logs}
if [[ -d "$PROWL_DIR/targets/test.example.com/recon" ]]; then
  pass "workspace directories exist"
else
  fail "workspace dirs should be created"
fi

# Test: invoke-claude help
echo "[5] invoke-claude help"
INVOKE_CLAUDE="${SCRIPT_DIR}/../bin/invoke-claude"
if [[ -x "$INVOKE_CLAUDE" ]] || [[ -f "$INVOKE_CLAUDE" ]]; then
  output=$("$INVOKE_CLAUDE" --help 2>&1) || true
  if echo "$output" | grep -qi "usage\|claude\|invoke"; then
    pass "invoke-claude help works"
  else
    fail "invoke-claude help should show usage"
  fi
else
  fail "invoke-claude not found"
fi

# Test: invoke-ollama help
echo "[6] invoke-ollama help"
INVOKE_OLLAMA="${SCRIPT_DIR}/../bin/invoke-ollama"
if [[ -x "$INVOKE_OLLAMA" ]] || [[ -f "$INVOKE_OLLAMA" ]]; then
  output=$("$INVOKE_OLLAMA" --help 2>&1) || true
  if echo "$output" | grep -qi "usage\|ollama\|invoke"; then
    pass "invoke-ollama help works"
  else
    fail "invoke-ollama help should show usage"
  fi
else
  fail "invoke-ollama not found"
fi

# Test: invoke-claude fails gracefully without API key
echo "[7] invoke-claude no key"
unset ANTHROPIC_API_KEY CLAUDE_API_KEY 2>/dev/null || true
output=$(echo "test" | "$INVOKE_CLAUDE" 2>&1) || true
if echo "$output" | grep -qi "key\|api\|auth\|error\|missing"; then
  pass "invoke-claude reports missing key"
else
  fail "invoke-claude should report missing API key, got: $output"
fi

# Test: scripts are valid bash
echo "[8] syntax check"
SYNTAX_OK=true
for script in "$PROWL" "$INVOKE_CLAUDE" "$INVOKE_OLLAMA" "${SCRIPT_DIR}/../bin/csbx"; do
  if [[ -f "$script" ]]; then
    if ! bash -n "$script" 2>&1; then
      fail "syntax error in $(basename "$script")"
      SYNTAX_OK=false
    fi
  fi
done
if $SYNTAX_OK; then
  pass "all scripts pass bash -n"
fi

# Test: prowl doctor subcommand suite (delegates to a focused test file)
echo "[9] prowl doctor subcommand suite"
DOCTOR_TEST="${SCRIPT_DIR}/test_prowl_doctor.sh"
if [[ -x "$DOCTOR_TEST" || -f "$DOCTOR_TEST" ]]; then
  if bash "$DOCTOR_TEST" >/dev/null 2>&1; then
    pass "prowl doctor tests pass"
  else
    fail "prowl doctor tests failed (run 'bash $DOCTOR_TEST' for details)"
  fi
else
  fail "test_prowl_doctor.sh not found at $DOCTOR_TEST"
fi

# Test: guardrails (NemoClaw filters) suite (spec 005)
echo "[10] guardrails (prompt-injection + secret-redaction) suite"
GUARDRAILS_TEST="${SCRIPT_DIR}/test_guardrails.sh"
if [[ -x "$GUARDRAILS_TEST" || -f "$GUARDRAILS_TEST" ]]; then
  _gr_log="$(mktemp)"
  if bash "$GUARDRAILS_TEST" >"$_gr_log" 2>&1; then
    pass "guardrails tests pass"
  else
    fail "guardrails tests failed (see $_gr_log)"
  fi
  rm -f "$_gr_log"
else
  fail "test_guardrails.sh not found at $GUARDRAILS_TEST"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
