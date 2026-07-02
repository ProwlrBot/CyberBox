#!/usr/bin/env bash
# Tests for harbinger phase_validate (PoC generation + screenshot evidence).
#
# Strategy:
#   We do NOT exercise the real Claude API or real Chromium here — both are
#   non-deterministic and external. Instead we stub `capture-screenshot` and
#   `invoke-claude` by intercepting them via a temporary PROWL_BIN override
#   inside an isolated workspace, and assert the orchestrator produces the
#   correct evidence layout (payloads, screenshots, manifest).
#
# Run: bash prowl/tests/test_phase_validate.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARBINGER_REAL="${SCRIPT_DIR}/../bin/harbinger"
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

WORK="$(mktemp -d)"
export PROWL_DIR="${WORK}/state"
trap 'rm -rf "$WORK"' EXIT

echo "=== test_phase_validate ==="

# ── Build a stub bin/ that proxies to the real harbinger but replaces the
#    invoke-claude and capture-screenshot helpers with deterministic fakes.
STUB_BIN="${WORK}/bin"
mkdir -p "$STUB_BIN"
ln -s "$HARBINGER_REAL" "${STUB_BIN}/harbinger"
ln -s "${SCRIPT_DIR}/../bin/invoke-ollama" "${STUB_BIN}/invoke-ollama"

# Stub invoke-claude: emits a fixed JSON PoC envelope (matches the system
# prompt's contract in phase_validate). Reads/ignores stdin and args.
cat > "${STUB_BIN}/invoke-claude" <<'STUB'
#!/usr/bin/env bash
# Drain stdin so the producer doesn't see EPIPE.
if [[ ! -t 0 ]]; then cat >/dev/null; fi
cat <<'JSON'
{
  "vulnerability_class": "XSS",
  "summary": "Reflected XSS in the search query parameter.",
  "curl": "curl -sk 'https://example.test/search?q=<svg/onload=alert(1)>'",
  "expected_response": "200 OK with the payload reflected unescaped in the HTML body",
  "steps": ["Send the curl above", "Open the response in a browser", "Observe alert dialog"],
  "confidence": "medium"
}
JSON
STUB
chmod +x "${STUB_BIN}/invoke-claude"

# Stub capture-screenshot: writes a 1x1 PNG and emits the success envelope on stdout.
# Honors `--timeout N` for arg-parse parity. If env STUB_CAPTURE_FAIL=1, exits non-zero
# with a `page_timeout` reason on stderr to exercise the retry path.
cat > "${STUB_BIN}/capture-screenshot" <<'STUB'
#!/usr/bin/env python3
import json, os, sys, base64

# 1x1 transparent PNG
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z"
    "uA9kkAAAAASUVORK5CYII="
)

argv = sys.argv[1:]
if not argv or argv[0] in ("-h", "--help"):
    sys.stdout.write("stub capture-screenshot\n"); sys.exit(0)

# Parse: URL OUTPUT [--timeout N]
positional, i, timeout = [], 0, 30
while i < len(argv):
    a = argv[i]
    if a == "--timeout":
        timeout = int(argv[i+1]); i += 2
    else:
        positional.append(a); i += 1

url, out = positional[0], positional[1]

if os.environ.get("STUB_CAPTURE_FAIL") == "1":
    sys.stderr.write(json.dumps({"status":"error","url":url,"error":"stubbed timeout","reason":"page_timeout"}))
    sys.stderr.write("\n")
    sys.exit(4)

with open(out, "wb") as fh:
    fh.write(base64.b64decode(PNG_B64))

sys.stdout.write(json.dumps({"status":"ok","url":url,"output":out,"bytes":os.path.getsize(out),"duration_ms":1}))
sys.stdout.write("\n")
sys.exit(0)
STUB
chmod +x "${STUB_BIN}/capture-screenshot"

HARBINGER_STUB="${STUB_BIN}/harbinger"
export PROWL_BIN="$STUB_BIN"
export HARBINGER_BIN="$STUB_BIN"
export PATH="${STUB_BIN}:${PATH}"
# Force the AI router into the "best" path via a fake API key.
export ANTHROPIC_API_KEY="sk-test-stub"

# ──────────────────────────────────────────────────────────────────────
# Test 1: --help renders cleanly and references the validate phase.
echo "[1] phase_validate --help"
output=$("$HARBINGER_STUB" phase_validate --help 2>&1) || true
if echo "$output" | grep -qi "validate" && echo "$output" | grep -qi "manifest"; then
  pass "phase_validate --help describes the phase"
else
  fail "phase_validate --help should mention validate + manifest, got: $output"
fi

# ──────────────────────────────────────────────────────────────────────
# Test 2: validate alias is recognized as a subcommand.
echo "[2] validate command recognized"
output=$("$HARBINGER_STUB" validate --help 2>&1) || true
if echo "$output" | grep -qi "validate"; then
  pass "validate --help recognized"
else
  fail "validate --help not recognized, got: $output"
fi

# ──────────────────────────────────────────────────────────────────────
# Test 3: missing workspace fails fast with a clear message.
echo "[3] missing workspace error"
output=$("$HARBINGER_STUB" validate ghost.example.com 2>&1) || true
if echo "$output" | grep -qi "no workspace\|workspace"; then
  pass "missing workspace produces clear error"
else
  fail "expected workspace error, got: $output"
fi

# ──────────────────────────────────────────────────────────────────────
# Test 4: empty findings exits gracefully (no manifest noise).
echo "[4] empty findings"
TARGET_EMPTY="empty.test"
mkdir -p "${PROWL_DIR}/targets/${TARGET_EMPTY}"/{recon,findings,evidence,reports,logs}
: > "${PROWL_DIR}/targets/${TARGET_EMPTY}/findings/nuclei.jsonl"
output=$("$HARBINGER_STUB" validate "$TARGET_EMPTY" 2>&1) || true
if echo "$output" | grep -qi "no nuclei findings\|no findings\|empty"; then
  pass "empty nuclei.jsonl handled gracefully"
else
  fail "empty findings should produce a warn message, got: $output"
fi

# ──────────────────────────────────────────────────────────────────────
# Test 5: Full happy-path with two findings produces manifest, payloads, screenshots.
echo "[5] full validate flow"
TARGET="testcorp.com"
WS="${PROWL_DIR}/targets/${TARGET}"
mkdir -p "${WS}"/{recon,findings,evidence,reports,logs}

# Fixture nuclei.jsonl: one high-XSS, one critical-SQLi, one info-level
# (must be filtered out), and one malformed line (must be skipped).
cat > "${WS}/findings/nuclei.jsonl" <<'EOF'
{"template-id":"reflected-xss","info":{"name":"Reflected XSS","severity":"high","description":"Reflected XSS in q parameter"},"matched-at":"https://example.test/search?q=test","curl-command":"curl 'https://example.test/search?q=<x>'"}
{"template-id":"sqli-blind","info":{"name":"Blind SQLi","severity":"critical","description":"Boolean-based blind SQLi in id"},"matched-at":"https://example.test/api/user?id=1"}
{"template-id":"tech-detect","info":{"name":"Tech Disclosure","severity":"info","description":"Stack disclosure in headers"},"matched-at":"https://example.test/"}
this-is-not-json-it-must-be-skipped
EOF

# jq must be available (harbinger requires it).
if ! command -v jq >/dev/null 2>&1; then
  fail "jq is not installed; phase_validate cannot run"
else
  output=$("$HARBINGER_STUB" validate "$TARGET" 2>&1) || true

  manifest="${WS}/evidence/manifest.json"
  if [[ -s "$manifest" ]]; then
    pass "manifest.json created"
  else
    fail "manifest.json missing"
    echo "---- harbinger output ----"
    echo "$output"
    echo "--------------------------"
  fi

  if [[ -s "$manifest" ]]; then
    findings_count=$(jq '.findings | length' "$manifest" 2>/dev/null || echo 0)
    if [[ "$findings_count" == "2" ]]; then
      pass "manifest contains exactly the 2 in-scope findings (info + malformed filtered)"
    else
      fail "expected 2 findings in manifest, got: $findings_count"
    fi

    if jq -e '.findings[] | select(.template_id == "reflected-xss" and .severity == "high" and .status == "ok")' "$manifest" >/dev/null 2>&1; then
      pass "XSS finding recorded with status=ok"
    else
      fail "XSS finding not properly recorded"
    fi

    if jq -e '.findings[] | select(.template_id == "sqli-blind" and .severity == "critical")' "$manifest" >/dev/null 2>&1; then
      pass "SQLi finding recorded as critical"
    else
      fail "SQLi finding not properly recorded"
    fi

    # Manifest entries must reference relative paths under evidence/.
    if jq -e '.findings[] | select(.screenshot | startswith("evidence/screenshots/"))' "$manifest" >/dev/null 2>&1 \
       && jq -e '.findings[] | select(.payload | startswith("evidence/payloads/"))' "$manifest" >/dev/null 2>&1; then
      pass "manifest references relative evidence paths"
    else
      fail "manifest paths not relative under evidence/"
    fi
  fi

  shot_count=$(find "${WS}/evidence/screenshots" -name '*.png' -type f 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$shot_count" == "2" ]]; then
    pass "2 PNG screenshots written"
  else
    fail "expected 2 screenshots, got $shot_count"
  fi

  payload_count=$(find "${WS}/evidence/payloads" -name '*.json' -type f 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$payload_count" == "2" ]]; then
    pass "2 payload JSON files written"
  else
    fail "expected 2 payloads, got $payload_count"
  fi

  # Each payload must include the AI envelope (vulnerability_class came from the stub).
  if find "${WS}/evidence/payloads" -name '*.json' -type f -exec jq -e '.payload.vulnerability_class' {} + >/dev/null 2>&1; then
    pass "payloads contain the AI-shaped envelope (source=ai)"
  else
    fail "payloads missing AI envelope"
  fi

  # validate.log captured execution metadata.
  if [[ -s "${WS}/logs/validate.log" ]] && grep -q "validate run start" "${WS}/logs/validate.log"; then
    pass "validate.log written with run metadata"
  else
    fail "validate.log missing or empty"
  fi

  # target.json got the validate phase appended.
  if [[ -s "${WS}/target.json" ]]; then
    if jq -e '.phases_completed | index("validate")' "${WS}/target.json" >/dev/null 2>&1; then
      pass "target.json records phases_completed += [\"validate\"]"
    else
      fail "target.json did not record validate phase"
    fi
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# Test 6: Capture failure is recorded as status=failed, processing continues.
echo "[6] capture failure path"
TARGET_FAIL="failtest.com"
WS_FAIL="${PROWL_DIR}/targets/${TARGET_FAIL}"
mkdir -p "${WS_FAIL}"/{recon,findings,evidence,reports,logs}
cat > "${WS_FAIL}/findings/nuclei.jsonl" <<'EOF'
{"template-id":"timeout-test","info":{"severity":"high","description":"slow target"},"matched-at":"https://slow.example.test/"}
EOF

STUB_CAPTURE_FAIL=1 "$HARBINGER_STUB" validate "$TARGET_FAIL" >/dev/null 2>&1 || true
manifest_fail="${WS_FAIL}/evidence/manifest.json"
if [[ -s "$manifest_fail" ]] && jq -e '.findings[0].status == "failed"' "$manifest_fail" >/dev/null 2>&1; then
  pass "capture failure recorded as status=failed"
else
  fail "expected failed status in manifest"
fi

# ──────────────────────────────────────────────────────────────────────
# Test 7: capture-screenshot helper rejects non-http(s) URLs cleanly.
# `file:///etc/passwd` has no netloc and triggers invalid_url before scheme parsing;
# `ftp://host/x` exercises the explicit invalid_scheme branch. Either rejection is
# acceptable — the security goal is "no non-http(s) capture", not the exact reason code.
echo "[7] capture-screenshot rejects non-http schemes"
out_file=$("${SCRIPT_DIR}/../bin/capture-screenshot" "file:///etc/passwd" "${WORK}/x.png" 2>&1) || true
out_ftp=$("${SCRIPT_DIR}/../bin/capture-screenshot" "ftp://example.test/x" "${WORK}/y.png" 2>&1) || true
if echo "$out_file" | grep -qE "invalid_url|invalid_scheme" \
   && echo "$out_ftp" | grep -q "invalid_scheme"; then
  pass "capture-screenshot rejects file:// and ftp:// schemes"
else
  fail "expected scheme/url rejection, file=$out_file ftp=$out_ftp"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
