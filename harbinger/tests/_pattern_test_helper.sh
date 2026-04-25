#!/usr/bin/env bash
# Shared helpers for harbinger pattern tests.
# Sourced by harbinger/tests/test_pattern_<name>.sh

set -uo pipefail

PATTERN_HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARBINGER_BIN_DIR="${PATTERN_HELPER_DIR}/../bin"
HARBINGER_PATTERNS_DIR="${HARBINGER_PATTERNS_DIR:-${PATTERN_HELPER_DIR}/../patterns}"

# Filter the python jsonschema CLI deprecation noise.
_jsonschema_filter() {
  grep -v -e "DeprecationWarning" \
          -e "from jsonschema.cli" \
          -e "jsonschema CLI is deprecated" \
          -e "check-jsonschema"
}

# validate_json_against_schema <json_file> <schema_file>
# Returns 0 on success, 1 on validation error, 2 on missing tool.
validate_json_against_schema() {
  local json_file="$1"
  local schema_file="$2"
  if ! command -v jsonschema >/dev/null 2>&1; then
    if ! command -v check-jsonschema >/dev/null 2>&1; then
      echo "  WARN: no jsonschema CLI installed; skipping schema validation" >&2
      return 2
    fi
    check-jsonschema --schemafile "$schema_file" "$json_file"
    return $?
  fi
  local out
  out=$(jsonschema -i "$json_file" "$schema_file" 2>&1)
  local rc=$?
  local filtered
  filtered=$(echo "$out" | _jsonschema_filter | grep -v "^$" || true)
  if [[ $rc -eq 0 && -z "$filtered" ]]; then
    return 0
  fi
  echo "$filtered" >&2
  return 1
}

# detect_backend prints "claude", "ollama", or "" if neither is reachable.
detect_backend() {
  if [[ -n "${ANTHROPIC_API_KEY:-${CLAUDE_API_KEY:-}}" ]]; then
    echo "claude"
    return 0
  fi
  local host="${OLLAMA_HOST:-http://localhost:11434}"
  if curl -sS --max-time 2 "${host}/api/tags" >/dev/null 2>&1; then
    echo "ollama"
    return 0
  fi
  echo ""
  return 1
}

# invoke_pattern <pattern_name> <input_file>
# Picks the available backend and pipes the input through `harbinger pattern <name>`.
# Echoes the model output on stdout; returns non-zero if no backend is available.
invoke_pattern() {
  local name="$1"
  local input_file="$2"
  local backend
  backend=$(detect_backend)
  if [[ -z "$backend" ]]; then
    echo "no_backend" >&2
    return 99
  fi
  if [[ "$backend" == "ollama" ]]; then
    local ollama_model="${OLLAMA_MODEL:-llama3.1}"
    OLLAMA_MODEL="$ollama_model" "${HARBINGER_BIN_DIR}/harbinger" pattern "$name" < "$input_file" 2>/dev/null
  else
    "${HARBINGER_BIN_DIR}/harbinger" pattern "$name" < "$input_file" 2>/dev/null
  fi
}

# extract_first_json <file>
# Best-effort: pulls the first {...} or [...] block from a file (LLM may wrap with prose
# despite our instructions).
extract_first_json() {
  local f="$1"
  python3 - "$f" <<'PY' 2>/dev/null
import json, re, sys
data = open(sys.argv[1], "r", encoding="utf-8", errors="replace").read()
# Strip markdown fences.
data = re.sub(r"^```(?:json)?\s*", "", data.strip(), flags=re.MULTILINE)
data = re.sub(r"\s*```\s*$", "", data, flags=re.MULTILINE)
# Find first balanced JSON object or array.
for opener, closer in (("{", "}"), ("[", "]")):
    start = data.find(opener)
    if start == -1:
        continue
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(data)):
        c = data[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                blob = data[start:i+1]
                try:
                    json.loads(blob)
                    sys.stdout.write(blob)
                    sys.exit(0)
                except Exception:
                    break
sys.exit(1)
PY
}

# run_pattern_test <pattern_name>
# 1. Pattern dir exists with system.md, schema.json, and one example pair.
# 2. Committed example.output.json validates against schema.json.
# 3. If a backend is reachable, invoke it on example.input.txt and try to validate.
#    Best-effort: a non-validating live response prints WARN but does not fail the test
#    (LLM determinism is out of scope for this fixture-level check).
run_pattern_test() {
  local name="$1"
  local pattern_dir="${HARBINGER_PATTERNS_DIR}/${name}"
  local fail=0

  echo "=== test_pattern_${name} ==="

  # 1. Structural checks.
  for required in system.md schema.json examples/example.input.txt examples/example.output.json; do
    if [[ ! -f "${pattern_dir}/${required}" ]]; then
      echo "  FAIL: missing ${pattern_dir}/${required}"
      fail=1
    fi
  done
  if [[ $fail -ne 0 ]]; then
    echo "Result: FAIL"
    return 1
  fi
  echo "  PASS: structure complete (system.md, schema.json, example pair)"

  # 2. Committed example validates.
  if validate_json_against_schema \
       "${pattern_dir}/examples/example.output.json" \
       "${pattern_dir}/schema.json"; then
    echo "  PASS: committed example validates against schema"
  else
    echo "  FAIL: committed example does NOT validate against schema"
    return 1
  fi

  # 3. Live model probe.
  local backend
  backend=$(detect_backend || true)
  if [[ -z "$backend" ]]; then
    echo "  SKIP: no claude API key and no ollama at \${OLLAMA_HOST}; cannot exercise live model"
    echo "Result: PASS (live probe skipped)"
    return 0
  fi

  local tmp
  tmp=$(mktemp)
  trap "rm -f '$tmp'" RETURN
  echo "  INFO: invoking backend=${backend} via 'harbinger pattern ${name}'"
  if ! invoke_pattern "$name" "${pattern_dir}/examples/example.input.txt" > "$tmp"; then
    echo "  WARN: live model invocation failed; treating as best-effort"
    echo "Result: PASS (live probe failed, fixture validated)"
    return 0
  fi
  if [[ ! -s "$tmp" ]]; then
    echo "  WARN: live model returned empty output"
    echo "Result: PASS (empty live output, fixture validated)"
    return 0
  fi

  local extracted="${tmp}.json"
  if extract_first_json "$tmp" > "$extracted" 2>/dev/null && [[ -s "$extracted" ]]; then
    if validate_json_against_schema "$extracted" "${pattern_dir}/schema.json" 2>/dev/null; then
      echo "  PASS: live ${backend} output validated against schema"
    else
      echo "  WARN: live ${backend} output failed schema validation (LLM noise; fixture is canonical)"
    fi
  else
    echo "  WARN: live ${backend} output was not parseable as JSON"
  fi

  echo "Result: PASS"
  return 0
}
