package csbx

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// fakeVerifier returns canned responses; tests construct one per case.
type fakeVerifier struct {
	prereqErr  error
	digest     string
	digestErr  error
	verifyOut  []byte
	verifyErr  error
	sbom       []byte
	sbomErr    error
	calls      []string
}

func (f *fakeVerifier) CheckPrereqs(ctx context.Context) error {
	f.calls = append(f.calls, "CheckPrereqs")
	return f.prereqErr
}

func (f *fakeVerifier) ResolveDigest(ctx context.Context, ref string) (string, error) {
	f.calls = append(f.calls, "ResolveDigest:"+ref)
	return f.digest, f.digestErr
}

func (f *fakeVerifier) CosignVerify(ctx context.Context, pinned, identityRegex, oidcIssuer string) ([]byte, error) {
	f.calls = append(f.calls, "CosignVerify:"+pinned)
	return f.verifyOut, f.verifyErr
}

func (f *fakeVerifier) InspectSBOM(ctx context.Context, pinned string) ([]byte, error) {
	f.calls = append(f.calls, "InspectSBOM:"+pinned)
	return f.sbom, f.sbomErr
}

func TestVerifyHappyPath(t *testing.T) {
	cosignOut := `[{"optional":{"Subject":"https://github.com/ProwlrBot/CyberBox/.github/workflows/cybersandbox-build.yml@refs/tags/v0.2.4","Bundle":{"Payload":{"logIndex":12345}}}}]`
	sbom := []byte(`{"spdxVersion":"SPDX-2.3","name":"cybersandbox","SPDXID":"SPDXRef-DOCUMENT","packages":[{"name":"a"}]}`)
	fv := &fakeVerifier{
		digest:    "sha256:deadbeef",
		verifyOut: []byte(cosignOut),
		sbom:      sbom,
	}
	res, err := Verify(context.Background(), fv, VerifyConfig{Image: "ghcr.io/example/x", Tag: "v1"})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !res.Signed {
		t.Error("Signed = false; want true")
	}
	if !res.SBOMPresent {
		t.Error("SBOMPresent = false; want true")
	}
	if !res.Success(false) {
		t.Error("Success(false) = false; want true on signed+SBOM")
	}
	if res.Digest != "sha256:deadbeef" {
		t.Errorf("Digest = %q", res.Digest)
	}
	if !strings.Contains(res.RekorURL, "logIndex=12345") {
		t.Errorf("RekorURL missing logIndex=12345; got %q", res.RekorURL)
	}
	if !strings.Contains(res.FulcioSubject, "cybersandbox-build.yml") {
		t.Errorf("FulcioSubject missing workflow; got %q", res.FulcioSubject)
	}
}

func TestVerifyPrereqMissing(t *testing.T) {
	fv := &fakeVerifier{prereqErr: ErrPrereqMissing}
	_, err := Verify(context.Background(), fv, VerifyConfig{})
	if err == nil {
		t.Fatal("expected error when prereqs missing")
	}
	if !errors.Is(err, ErrPrereqMissing) {
		t.Errorf("expected ErrPrereqMissing; got %v", err)
	}
	// Should not have proceeded to ResolveDigest.
	if len(fv.calls) != 1 {
		t.Errorf("expected only CheckPrereqs called; got %v", fv.calls)
	}
}

func TestVerifyDigestResolutionFails(t *testing.T) {
	fv := &fakeVerifier{digestErr: errors.New("registry unreachable")}
	res, err := Verify(context.Background(), fv, VerifyConfig{Image: "x", Tag: "y"})
	if err == nil {
		t.Fatal("expected digest-resolution error")
	}
	if res.Signed {
		t.Error("Signed should be false on digest failure")
	}
	if !strings.Contains(res.FailureReason, "could not resolve digest") {
		t.Errorf("FailureReason = %q", res.FailureReason)
	}
}

func TestVerifyCosignFails(t *testing.T) {
	fv := &fakeVerifier{
		digest:    "sha256:dead",
		verifyErr: errors.New("certificate identity mismatch"),
	}
	res, err := Verify(context.Background(), fv, VerifyConfig{})
	if err == nil {
		t.Fatal("expected cosign error")
	}
	if res.Signed {
		t.Error("Signed should be false on cosign failure")
	}
	if !strings.Contains(res.FailureReason, "cosign signature verification failed") {
		t.Errorf("FailureReason = %q", res.FailureReason)
	}
}

func TestVerifySBOMTooSmall(t *testing.T) {
	cosignOut := `[{}]`
	tinySBOM := []byte(`{}`) // 2 bytes
	fv := &fakeVerifier{
		digest:    "sha256:dead",
		verifyOut: []byte(cosignOut),
		sbom:      tinySBOM,
	}
	res, err := Verify(context.Background(), fv, VerifyConfig{})
	if err == nil {
		t.Fatal("expected SBOM-too-small error")
	}
	if !res.Signed {
		t.Error("Signed should still be true (cosign passed)")
	}
	if res.SBOMPresent {
		t.Error("SBOMPresent should be false")
	}
	if !strings.Contains(res.FailureReason, "suspiciously small") {
		t.Errorf("FailureReason = %q", res.FailureReason)
	}
}

func TestVerifySBOMMissingMarkers(t *testing.T) {
	cosignOut := `[{}]`
	bogusSBOM := []byte(`{"this":"is JSON but not an SBOM","field":"with at least 64 bytes of padding to pass the size check, no SPDX or CycloneDX markers anywhere"}`)
	fv := &fakeVerifier{
		digest:    "sha256:dead",
		verifyOut: []byte(cosignOut),
		sbom:      bogusSBOM,
	}
	res, err := Verify(context.Background(), fv, VerifyConfig{})
	if err == nil {
		t.Fatal("expected SBOM-marker error")
	}
	if !strings.Contains(res.FailureReason, "SPDX or CycloneDX markers") {
		t.Errorf("FailureReason = %q", res.FailureReason)
	}
}

func TestVerifySkipSBOM(t *testing.T) {
	cosignOut := `[{}]`
	fv := &fakeVerifier{
		digest:    "sha256:dead",
		verifyOut: []byte(cosignOut),
		// sbom intentionally empty — should not be called
	}
	res, err := Verify(context.Background(), fv, VerifyConfig{SkipSBOM: true})
	if err != nil {
		t.Fatalf("SkipSBOM Verify: %v", err)
	}
	if !res.Success(true) {
		t.Error("Success(true) should be true on signed run with SkipSBOM=true")
	}
	for _, call := range fv.calls {
		if strings.HasPrefix(call, "InspectSBOM") {
			t.Errorf("InspectSBOM should not be called when SkipSBOM=true; got %v", fv.calls)
		}
	}
}

func TestVerifyDefaultsApplied(t *testing.T) {
	fv := &fakeVerifier{digest: "sha256:dead", verifyOut: []byte(`[{}]`), sbom: []byte(`{"spdxVersion":"SPDX-2.3","padding":"to-meet-min-size-of-64-bytes-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`)}
	cfg := VerifyConfig{} // all empty
	cfg.applyDefaults()
	if cfg.Image != DefaultVerifyImage {
		t.Errorf("Image default not applied: %q", cfg.Image)
	}
	if cfg.IdentityRegex != DefaultVerifyIdentityRegex {
		t.Errorf("IdentityRegex default not applied: %q", cfg.IdentityRegex)
	}
	// And run with empty config to confirm Verify itself applies defaults.
	res, err := Verify(context.Background(), fv, VerifyConfig{})
	if err != nil {
		t.Fatalf("Verify with empty config: %v", err)
	}
	if !res.Success(false) {
		t.Errorf("expected success; got result %+v", res)
	}
}

func TestResolveRefWithExplicitRef(t *testing.T) {
	cfg := VerifyConfig{
		Image: "ghcr.io/x/cybersandbox",
		Tag:   "latest",
		Ref:   "ghcr.io/x/cybersandbox@sha256:abc",
	}
	cfg.applyDefaults()
	ref, repo := cfg.resolveRef()
	if ref != "ghcr.io/x/cybersandbox@sha256:abc" {
		t.Errorf("ref = %q", ref)
	}
	if repo != "ghcr.io/x/cybersandbox" {
		t.Errorf("repo = %q", repo)
	}
}

func TestResolveRefWithImageTag(t *testing.T) {
	cfg := VerifyConfig{Image: "ghcr.io/x/cybersandbox", Tag: "v1.2"}
	cfg.applyDefaults()
	ref, repo := cfg.resolveRef()
	if ref != "ghcr.io/x/cybersandbox:v1.2" {
		t.Errorf("ref = %q", ref)
	}
	if repo != "ghcr.io/x/cybersandbox" {
		t.Errorf("repo = %q", repo)
	}
}

// ─── ParseRekorURL / ParseFulcioSubject ───

func TestParseRekorURLNewerCosign(t *testing.T) {
	body := []byte(`[{"optional":{"Bundle":{"Payload":{"logIndex":98765}}}}]`)
	got := ParseRekorURL(body, "https://rekor.sigstore.dev")
	if !strings.Contains(got, "logIndex=98765") {
		t.Errorf("URL missing logIndex; got %q", got)
	}
	if !strings.HasPrefix(got, "https://rekor.sigstore.dev/api/v1/log/entries") {
		t.Errorf("URL prefix wrong; got %q", got)
	}
}

func TestParseRekorURLOlderCosign(t *testing.T) {
	body := []byte(`[{"rekorBundle":{"Payload":{"logIndex":42}}}]`)
	got := ParseRekorURL(body, "https://rekor.sigstore.dev")
	if !strings.Contains(got, "logIndex=42") {
		t.Errorf("URL missing logIndex; got %q", got)
	}
}

func TestParseRekorURLSingleObject(t *testing.T) {
	body := []byte(`{"optional":{"Bundle":{"Payload":{"logIndex":7}}}}`)
	got := ParseRekorURL(body, "https://rekor.example.com")
	if got != "https://rekor.example.com/api/v1/log/entries?logIndex=7" {
		t.Errorf("URL = %q", got)
	}
}

func TestParseRekorURLAbsentReturnsEmpty(t *testing.T) {
	body := []byte(`[{"optional":{}}]`)
	if got := ParseRekorURL(body, "https://rekor.sigstore.dev"); got != "" {
		t.Errorf("expected empty; got %q", got)
	}
}

func TestParseRekorURLBlankBaseFallsBackToDefault(t *testing.T) {
	body := []byte(`[{"optional":{"Bundle":{"Payload":{"logIndex":1}}}}]`)
	got := ParseRekorURL(body, "")
	if !strings.HasPrefix(got, DefaultVerifyRekorURL) {
		t.Errorf("expected default base; got %q", got)
	}
}

func TestParseRekorURLNonJSONReturnsEmpty(t *testing.T) {
	if got := ParseRekorURL([]byte("not json"), "https://x"); got != "" {
		t.Errorf("expected empty for non-JSON; got %q", got)
	}
}

func TestParseRekorURLToleratesPrefixNoise(t *testing.T) {
	// cosign sometimes emits human-readable lines before the JSON. The
	// parser should locate the first { or [ and parse from there.
	body := []byte("Verification for ghcr.io/x@sha256:dead --\n[{\"optional\":{\"Bundle\":{\"Payload\":{\"logIndex\":3}}}}]")
	if got := ParseRekorURL(body, "https://x"); !strings.Contains(got, "logIndex=3") {
		t.Errorf("expected to skip prefix and parse JSON; got %q", got)
	}
}

func TestParseFulcioSubjectFromOptional(t *testing.T) {
	body := []byte(`[{"optional":{"Subject":"https://github.com/x/y"}}]`)
	if got := ParseFulcioSubject(body); got != "https://github.com/x/y" {
		t.Errorf("subject = %q", got)
	}
}

func TestParseFulcioSubjectLowercaseKey(t *testing.T) {
	body := []byte(`[{"optional":{"subject":"abc@def"}}]`)
	if got := ParseFulcioSubject(body); got != "abc@def" {
		t.Errorf("subject = %q", got)
	}
}

func TestParseFulcioSubjectFromCriticalIdentity(t *testing.T) {
	body := []byte(`[{"critical":{"identity":{"docker-reference":"ghcr.io/x/cybersandbox"}}}]`)
	if got := ParseFulcioSubject(body); got != "ghcr.io/x/cybersandbox" {
		t.Errorf("subject = %q", got)
	}
}

func TestParseFulcioSubjectAbsent(t *testing.T) {
	body := []byte(`[{}]`)
	if got := ParseFulcioSubject(body); got != "" {
		t.Errorf("expected empty; got %q", got)
	}
}

// ─── ExecVerifier surface tests (no live cosign/docker required) ───

func TestExecVerifierResolveDigestParsesPinnedRef(t *testing.T) {
	// A ref already pinned by digest doesn't require any subprocess.
	v := NewExecVerifier()
	got, err := v.ResolveDigest(context.Background(), "ghcr.io/x/y@sha256:abc")
	if err != nil {
		t.Fatalf("ResolveDigest: %v", err)
	}
	if got != "sha256:abc" {
		t.Errorf("digest = %q", got)
	}
}

// ─── Result.Success ───

func TestResultSuccessLogic(t *testing.T) {
	cases := []struct {
		name      string
		signed    bool
		sbom      bool
		skipSBOM  bool
		want      bool
	}{
		{"signed+sbom", true, true, false, true},
		{"signed+sbom skip", true, false, true, true},
		{"signed no sbom required", true, true, true, true},
		{"unsigned even with skip", false, true, true, false},
		{"signed but no SBOM and not skipped", true, false, false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := &VerifyResult{Signed: c.signed, SBOMPresent: c.sbom}
			if got := r.Success(c.skipSBOM); got != c.want {
				t.Errorf("Success(%v) = %v; want %v", c.skipSBOM, got, c.want)
			}
		})
	}
}
