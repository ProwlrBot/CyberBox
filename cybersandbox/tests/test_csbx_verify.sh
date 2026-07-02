#!/usr/bin/env bash
# Tests for `csbx verify` — supply-chain verifier (spec 009).
#
# We exercise the wrapper logic, not Sigstore. cosign/docker are stubbed via
# fake binaries on PATH so the test runs offline and on every developer box
# (no real image pull, no Rekor round-trip). The two paths covered match the
# acceptance criteria in
# .auto-claude/specs/009-csbx-verify-one-command-supply-chain-verification/spec.md:
#
#   1. Happy path  -> exit 0, prints Fulcio + Rekor URLs
#   2. Tampered    -> non-zero, prints actionable error
#
# A third case asserts that missing cosign yields a clean exit-2 ("prereq
# missing"), separate from a real verification failure.
#
# Run: bash cybersandbox/tests/test_csbx_verify.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CSBX="${REPO_ROOT}/prowl/bin/csbx"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

# ── Sandbox ─────────────────────────────────────────────────
SANDBOX="$(mktemp -d)"
export CSBX_HOME="${SANDBOX}/csbx"
STUB_BIN="${SANDBOX}/bin"
mkdir -p "$STUB_BIN" "$CSBX_HOME"

cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT

# ── Stub fixtures ───────────────────────────────────────────
# A real cosign verify response shape (only the fields we extract).
COSIGN_HAPPY_JSON='[
  {
    "critical": {
      "identity": {"docker-reference": "ghcr.io/prowlrbot/cybersandbox"},
      "image": {"docker-manifest-digest": "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"},
      "type": "cosign container image signature"
    },
    "optional": {
      "Bundle": {
        "Payload": {
          "logIndex": 12345678,
          "integratedTime": 1714000000
        }
      },
      "Subject": "https://github.com/ProwlrBot/CyberBox/.github/workflows/cybersandbox-build.yml@refs/heads/main"
    }
  }
]'

write_stub_cosign_pass() {
  cat > "${STUB_BIN}/cosign" <<COSIGN
#!/usr/bin/env bash
# Stub: succeeds for any image, prints a realistic verify JSON.
if [[ "\$1" == "verify" ]]; then
  cat <<'JSON'
${COSIGN_HAPPY_JSON}
JSON
  exit 0
fi
exit 0
COSIGN
  chmod +x "${STUB_BIN}/cosign"
}

write_stub_cosign_fail() {
  cat > "${STUB_BIN}/cosign" <<'COSIGN'
#!/usr/bin/env bash
# Stub: simulates a tampered image — no matching signatures.
if [[ "$1" == "verify" ]]; then
  echo "Error: no matching signatures: " >&2
  echo "  image was not signed by the expected workflow identity" >&2
  exit 1
fi
exit 0
COSIGN
  chmod +x "${STUB_BIN}/cosign"
}

write_stub_docker() {
  # Returns a deterministic digest for any tag, and a minimal SPDX SBOM.
  cat > "${STUB_BIN}/docker" <<'DOCKER'
#!/usr/bin/env bash
case "$*" in
  *"buildx imagetools inspect"*"json .SBOM"*)
    cat <<'JSON'
{"SPDXID":"SPDXRef-DOCUMENT","spdxVersion":"SPDX-2.3","name":"cybersandbox","packages":[{"name":"alpine","SPDXID":"SPDXRef-Package-alpine"}]}
JSON
    exit 0
    ;;
  *"buildx imagetools inspect"*"Manifest.Digest"*)
    echo "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    exit 0
    ;;
  *"image inspect"*)
    echo ""
    exit 0
    ;;
esac
exit 0
DOCKER
  chmod +x "${STUB_BIN}/docker"
}

run_verify() {
  PATH="${STUB_BIN}:${PATH}" "$CSBX" verify "$@"
}

echo "=== csbx verify tests (spec 009) ==="

# ── 1) Happy path ───────────────────────────────────────────
echo "[1] happy path: signed image, valid SBOM, Rekor entry"
write_stub_cosign_pass
write_stub_docker
out=$(run_verify --tag latest 2>&1)
rc=$?
if [[ $rc -eq 0 ]]; then
  pass "exit 0 on signed image"
else
  fail "expected exit 0, got $rc; output: $out"
fi
if echo "$out" | grep -q "Supply-chain verification: PASS"; then
  pass "prints PASS banner"
else
  fail "missing PASS banner; output: $out"
fi
if echo "$out" | grep -q "rekor:.*rekor.sigstore.dev/api/v1/log/entries?logIndex=12345678"; then
  pass "prints Rekor transparency-log URL"
else
  fail "Rekor URL missing; output: $out"
fi
if echo "$out" | grep -q "fulcio:.*search.sigstore.dev"; then
  pass "prints Fulcio cert lookup URL"
else
  fail "Fulcio URL missing; output: $out"
fi
if echo "$out" | grep -q "signer:.*cybersandbox-build.yml"; then
  pass "prints signer identity"
else
  fail "signer identity missing; output: $out"
fi

# ── 2) Tampered / unsigned image ────────────────────────────
echo "[2] tampered path: cosign verify fails"
write_stub_cosign_fail
write_stub_docker
out=$(run_verify --tag latest 2>&1)
rc=$?
if [[ $rc -ne 0 ]]; then
  pass "non-zero exit on tampered image (rc=$rc)"
else
  fail "expected non-zero exit, got 0; output: $out"
fi
if echo "$out" | grep -qi "Signature verification FAILED"; then
  pass "prints actionable failure message"
else
  fail "expected 'Signature verification FAILED'; output: $out"
fi
if echo "$out" | grep -qi "tampered\|unsigned"; then
  pass "hints at tampered/unsigned cause"
else
  fail "expected tamper hint in error output; output: $out"
fi

# ── 3) Prerequisites missing ────────────────────────────────
echo "[3] cosign missing: clean prereq error (exit 2)"
rm -f "${STUB_BIN}/cosign"
out=$(run_verify --tag latest 2>&1)
rc=$?
if [[ $rc -eq 2 ]]; then
  pass "exit 2 when cosign absent"
else
  fail "expected exit 2, got $rc; output: $out"
fi
if echo "$out" | grep -qi "cosign not found"; then
  pass "actionable cosign-missing message"
else
  fail "missing 'cosign not found' hint; output: $out"
fi

# ── 4) --help is hermetic (no prereqs) ──────────────────────
echo "[4] verify --help works without cosign/docker"
out=$(PATH="${STUB_BIN}:${PATH}" "$CSBX" verify --help 2>&1)
rc=$?
if [[ $rc -eq 0 ]] && echo "$out" | grep -q "csbx verify"; then
  pass "--help renders without prereqs"
else
  fail "--help failed (rc=$rc); output: $out"
fi

# ── 5) verify is wired into top-level usage ─────────────────
echo "[5] top-level help mentions verify"
out=$("$CSBX" --help 2>&1)
if echo "$out" | grep -q "verify"; then
  pass "top-level usage advertises verify"
else
  fail "top-level usage missing 'verify'; output: $out"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
