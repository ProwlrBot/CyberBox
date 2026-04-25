package csbx

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	csbxstate "github.com/ProwlrBot/CyberBox/cli/internal/csbx"
)

// fakeVerifier mirrors the one in internal/csbx but lives in this
// package so test_csbx.sh-style assertions can live next to the cobra
// wrapper. Could deduplicate later if the surface stays parallel.
type fakeVerifier struct {
	prereqErr error
	digest    string
	digestErr error
	verifyOut []byte
	verifyErr error
	sbom      []byte
	sbomErr   error
}

func (f *fakeVerifier) CheckPrereqs(ctx context.Context) error { return f.prereqErr }
func (f *fakeVerifier) ResolveDigest(ctx context.Context, ref string) (string, error) {
	return f.digest, f.digestErr
}
func (f *fakeVerifier) CosignVerify(ctx context.Context, pinned, id, iss string) ([]byte, error) {
	return f.verifyOut, f.verifyErr
}
func (f *fakeVerifier) InspectSBOM(ctx context.Context, pinned string) ([]byte, error) {
	return f.sbom, f.sbomErr
}

// signedSBOMVerifier is the canonical "everything ok" fake.
func signedSBOMVerifier() *fakeVerifier {
	return &fakeVerifier{
		digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd",
		verifyOut: []byte(`[{"optional":{"Subject":"https://github.com/ProwlrBot/CyberBox/.github/workflows/cybersandbox-build.yml@refs/tags/v0.2.4","Bundle":{"Payload":{"logIndex":12345}}}}]`),
		sbom:      []byte(`{"spdxVersion":"SPDX-2.3","name":"cybersandbox","SPDXID":"SPDXRef-DOCUMENT","packages":[{"name":"a"}]}`),
	}
}

func TestRunVerifyHappyPathExit0(t *testing.T) {
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	code := runVerify(context.Background(), signedSBOMVerifier(), csbxstate.VerifyConfig{}, stdout, stderr)
	if code != verifyExitOK {
		t.Errorf("exit code = %d; want %d", code, verifyExitOK)
	}
	out := stdout.String()
	for _, expect := range []string{
		"[+] Verifying",
		"[✓] Resolved digest: sha256:",
		"[✓] cosign signature: VALID",
		"[✓] SBOM present",
		"Supply-chain verification: PASS",
		"image:",
		"digest:",
		"signer:",
		"rekor:",
		"fulcio:",
	} {
		if !strings.Contains(out, expect) {
			t.Errorf("stdout missing %q; got %q", expect, out)
		}
	}
	if stderr.Len() != 0 {
		t.Errorf("stderr should be empty on PASS; got %q", stderr.String())
	}
}

func TestRunVerifyPrereqMissingExit2(t *testing.T) {
	fv := &fakeVerifier{prereqErr: csbxstate.ErrPrereqMissing}
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	code := runVerify(context.Background(), fv, csbxstate.VerifyConfig{}, stdout, stderr)
	if code != verifyExitPrereqMissing {
		t.Errorf("exit code = %d; want %d", code, verifyExitPrereqMissing)
	}
	if !strings.Contains(stderr.String(), "prerequisite tool missing") {
		t.Errorf("stderr should explain prereq; got %q", stderr.String())
	}
}

func TestRunVerifyCosignFailedExit1(t *testing.T) {
	fv := &fakeVerifier{
		digest:    "sha256:dead",
		verifyErr: errors.New("certificate identity mismatch"),
	}
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	code := runVerify(context.Background(), fv, csbxstate.VerifyConfig{}, stdout, stderr)
	if code != verifyExitFailed {
		t.Errorf("exit code = %d; want %d", code, verifyExitFailed)
	}
	for _, expect := range []string{
		"cosign signature verification failed",
		"Possible causes:",
		"identity regex does not match",
	} {
		if !strings.Contains(stderr.String(), expect) {
			t.Errorf("stderr missing %q; got %q", expect, stderr.String())
		}
	}
}

func TestRunVerifySBOMFailedExit1(t *testing.T) {
	fv := signedSBOMVerifier()
	fv.sbom = []byte(`{}`) // too small
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	code := runVerify(context.Background(), fv, csbxstate.VerifyConfig{}, stdout, stderr)
	if code != verifyExitFailed {
		t.Errorf("exit code = %d; want %d", code, verifyExitFailed)
	}
	if !strings.Contains(stderr.String(), "suspiciously small") {
		t.Errorf("stderr should mention 'suspiciously small'; got %q", stderr.String())
	}
	// Signed line should still have printed before SBOM failure.
	if !strings.Contains(stdout.String(), "cosign signature: VALID") {
		t.Errorf("stdout should still show cosign VALID before SBOM fail; got %q", stdout.String())
	}
}

func TestRunVerifySkipSBOMSuppressesSBOMLine(t *testing.T) {
	fv := signedSBOMVerifier()
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	code := runVerify(context.Background(), fv, csbxstate.VerifyConfig{SkipSBOM: true}, stdout, stderr)
	if code != verifyExitOK {
		t.Errorf("exit code = %d; want %d", code, verifyExitOK)
	}
	if strings.Contains(stdout.String(), "SBOM present") {
		t.Errorf("--skip-sbom should suppress 'SBOM present' line; got %q", stdout.String())
	}
	_ = stderr
}

func TestRunVerifySkipRekorSuppressesRekorLine(t *testing.T) {
	fv := signedSBOMVerifier()
	stdout, _ := &bytes.Buffer{}, &bytes.Buffer{}
	code := runVerify(context.Background(), fv, csbxstate.VerifyConfig{SkipRekor: true}, stdout, &bytes.Buffer{})
	if code != verifyExitOK {
		t.Errorf("exit code = %d", code)
	}
	if strings.Contains(stdout.String(), "rekor:") {
		t.Errorf("--skip-rekor should suppress rekor line; got %q", stdout.String())
	}
}

func TestRunVerifyExplicitRefShownInOutput(t *testing.T) {
	fv := signedSBOMVerifier()
	stdout, _ := &bytes.Buffer{}, &bytes.Buffer{}
	cfg := csbxstate.VerifyConfig{Ref: "ghcr.io/example/x@sha256:abcd"}
	code := runVerify(context.Background(), fv, cfg, stdout, &bytes.Buffer{})
	if code != verifyExitOK {
		t.Errorf("exit code = %d", code)
	}
	if !strings.Contains(stdout.String(), "[+] Verifying ghcr.io/example/x@sha256:abcd") {
		t.Errorf("expected 'Verifying' line with explicit --ref; got %q", stdout.String())
	}
}

func TestRunVerifyDigestResolutionFailureExit1(t *testing.T) {
	fv := &fakeVerifier{digestErr: errors.New("docker buildx imagetools inspect: timeout")}
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	code := runVerify(context.Background(), fv, csbxstate.VerifyConfig{}, stdout, stderr)
	if code != verifyExitFailed {
		t.Errorf("exit code = %d; want %d", code, verifyExitFailed)
	}
	if !strings.Contains(stderr.String(), "could not resolve digest") {
		t.Errorf("stderr missing reason; got %q", stderr.String())
	}
}

func TestStripSHA256Prefix(t *testing.T) {
	cases := []struct{ in, want string }{
		{"sha256:abc", "abc"},
		{"sha256:", ""},
		{"abc", "abc"},
		{"", ""},
	}
	for _, c := range cases {
		if got := stripSHA256Prefix(c.in); got != c.want {
			t.Errorf("stripSHA256Prefix(%q) = %q; want %q", c.in, got, c.want)
		}
	}
}
