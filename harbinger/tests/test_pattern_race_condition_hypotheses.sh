#!/usr/bin/env bash
# Test: pattern race_condition_hypotheses
# Validates fixture and (best-effort) live invoke-claude/invoke-ollama output against schema.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_pattern_test_helper.sh
. "${SCRIPT_DIR}/_pattern_test_helper.sh"
run_pattern_test "race_condition_hypotheses"
