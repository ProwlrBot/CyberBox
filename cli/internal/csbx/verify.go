package csbx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// Defaults mirror bash csbx:655-659. Override via env vars or CLI flags.
// The identity regex pins to the specific GitHub workflow file that signs
// CyberSandbox images — anyone who can push to that file controls the
// trust root, so changes to it are intentional and code-reviewed.
const (
	DefaultVerifyImage         = "ghcr.io/prowlrbot/cybersandbox"
	DefaultVerifyTag           = "latest"
	DefaultVerifyIdentityRegex = `^https://github.com/ProwlrBot/CyberBox/.github/workflows/cybersandbox-build.yml@refs/`
	DefaultVerifyOIDCIssuer    = "https://token.actions.githubusercontent.com"
	DefaultVerifyRekorURL      = "https://rekor.sigstore.dev"

	// SBOM payload below 64 bytes is suspicious — bash csbx:858 uses the
	// same threshold. SPDX or CycloneDX markers must be present in the
	// JSON; anything else means a referrer that isn't a real SBOM.
	minSBOMSize = 64
)

// VerifyConfig is the user-facing knob set. Zero values fall back to the
// Default* constants above.
type VerifyConfig struct {
	// Image (e.g. ghcr.io/prowlrbot/cybersandbox) — used with Tag if Ref
	// is empty.
	Image string
	// Tag (e.g. latest, sha-abc1234) — used with Image if Ref is empty.
	Tag string
	// Ref bypasses Image+Tag entirely. Accepts repo:tag and
	// repo@sha256:... forms.
	Ref string
	// IdentityRegex pins the cosign keyless certificate identity. The
	// default points at this repo's build workflow.
	IdentityRegex string
	// OIDCIssuer pins the cosign keyless OIDC issuer (Fulcio).
	OIDCIssuer string
	// SkipSBOM disables the SBOM presence/format check.
	SkipSBOM bool
	// SkipRekor suppresses the printed Rekor URL in the success report.
	// (cosign always hits Rekor during verify; this flag only affects
	// the human-readable report, not the trust check.)
	SkipRekor bool
}

// applyDefaults is internal — fills in empty fields from the constants.
func (c *VerifyConfig) applyDefaults() {
	if c.Image == "" {
		c.Image = DefaultVerifyImage
	}
	if c.Tag == "" {
		c.Tag = DefaultVerifyTag
	}
	if c.IdentityRegex == "" {
		c.IdentityRegex = DefaultVerifyIdentityRegex
	}
	if c.OIDCIssuer == "" {
		c.OIDCIssuer = DefaultVerifyOIDCIssuer
	}
}

// resolveRef returns the (ref, repo) pair the verify pipeline operates
// on. Ref takes precedence; otherwise it's image:tag.
func (c *VerifyConfig) resolveRef() (ref, repo string) {
	if c.Ref != "" {
		ref = c.Ref
	} else {
		ref = c.Image + ":" + c.Tag
	}
	repo = ref
	if i := strings.Index(repo, "@"); i >= 0 {
		repo = repo[:i]
	}
	if i := strings.LastIndex(repo, ":"); i >= 0 {
		// Don't strip 'sha256' — that's a digest, not a tag. Tags don't
		// have ':' inside them.
		if !strings.HasPrefix(repo[i+1:], "sha256") {
			repo = repo[:i]
		}
	}
	return ref, repo
}

// VerifyResult captures the outcome of a verification pipeline. Success
// (Signed && (SkipSBOM || SBOMPresent)) is the merge gate.
type VerifyResult struct {
	Repo           string
	Digest         string // sha256:...
	Signed         bool
	SBOMPresent    bool
	SBOMSize       int
	FulcioSubject  string
	RekorURL       string
	FailureReason  string // populated on Signed=false or SBOMPresent=false
}

// Success reports whether the pipeline merge-gate passes. SBOM is
// optional when SkipSBOM=true.
func (r *VerifyResult) Success(skipSBOM bool) bool {
	if !r.Signed {
		return false
	}
	if skipSBOM {
		return true
	}
	return r.SBOMPresent
}

// Verifier is the seam between the verify orchestrator and the
// cosign/docker subprocess world. Tests inject fakes; production wires
// the cosign+docker shellouts via NewExecVerifier.
//
// The audit (cli/cmd/csbx/PORT_AUDIT.md) deliberately keeps cosign and
// docker as subprocess invocations rather than substituting Go
// libraries: the trust model is "shell out to the same binary the user
// audited", so a Go-cosign port would fork the trust surface.
type Verifier interface {
	// CheckPrereqs returns an error wrapping ErrPrereqMissing if any
	// required external tool (cosign, docker) is not in PATH.
	CheckPrereqs(ctx context.Context) error

	// ResolveDigest takes a tag or @digest reference and returns the
	// canonical sha256:... digest. For a @sha256:... ref the parsing is
	// trivial; for tags it must consult the registry (via docker buildx
	// imagetools inspect) or a locally-pulled image.
	ResolveDigest(ctx context.Context, ref string) (string, error)

	// CosignVerify runs `cosign verify <pinned> --certificate-identity-regexp
	// <re> --certificate-oidc-issuer <issuer>` and returns the combined
	// stdout+stderr. A non-nil error means the verification failed.
	CosignVerify(ctx context.Context, pinned, identityRegex, oidcIssuer string) ([]byte, error)

	// InspectSBOM runs `docker buildx imagetools inspect <pinned> --format '{{ json .SBOM }}'`
	// and returns the raw SBOM JSON payload.
	InspectSBOM(ctx context.Context, pinned string) ([]byte, error)
}

// ErrPrereqMissing is returned from CheckPrereqs (and surfaces through
// Verify) when cosign or docker isn't in PATH. The CLI converts this
// into exit code 2 — distinguishable from verification failure (exit 1).
var ErrPrereqMissing = errors.New("prerequisite tool missing")

// Verify runs the full pipeline against the provided Verifier and
// returns a populated VerifyResult. Pipeline stages:
//
//  1. CheckPrereqs (cosign + docker)
//  2. ResolveDigest
//  3. CosignVerify — populates Signed + parses Rekor/Fulcio
//  4. InspectSBOM (skipped if cfg.SkipSBOM)
//
// A failure at any stage returns the partial result alongside an error
// so the caller can print structured output for both success and
// failure paths.
func Verify(ctx context.Context, v Verifier, cfg VerifyConfig) (*VerifyResult, error) {
	cfg.applyDefaults()

	if err := v.CheckPrereqs(ctx); err != nil {
		return nil, err
	}

	ref, repo := cfg.resolveRef()
	result := &VerifyResult{Repo: repo}

	digest, err := v.ResolveDigest(ctx, ref)
	if err != nil {
		result.FailureReason = "could not resolve digest"
		return result, fmt.Errorf("resolve digest for %q: %w", ref, err)
	}
	result.Digest = digest

	pinned := repo + "@" + digest

	verifyOut, err := v.CosignVerify(ctx, pinned, cfg.IdentityRegex, cfg.OIDCIssuer)
	if err != nil {
		result.FailureReason = "cosign signature verification failed"
		return result, fmt.Errorf("cosign verify %q: %w", pinned, err)
	}
	result.Signed = true

	// The audit's recommendation: parse Rekor/Fulcio extraction in
	// native Go rather than shelling to python heredocs. Both extractors
	// are pure JSON walks — no subprocess needed.
	if rekorURL := ParseRekorURL(verifyOut, DefaultVerifyRekorURL); rekorURL != "" {
		result.RekorURL = rekorURL
	}
	if subject := ParseFulcioSubject(verifyOut); subject != "" {
		result.FulcioSubject = subject
	}

	if cfg.SkipSBOM {
		return result, nil
	}

	sbom, err := v.InspectSBOM(ctx, pinned)
	if err != nil {
		// SBOM fetch failure is non-fatal in the bash csbx — it just
		// warns. Mirror that: report SBOM not present, but don't return
		// an error, so the merge gate can still succeed when SkipSBOM
		// is true (which it isn't here, but the policy is documented).
		result.FailureReason = "SBOM unreachable: " + err.Error()
		return result, nil
	}
	result.SBOMSize = len(sbom)

	if len(sbom) < minSBOMSize {
		result.FailureReason = fmt.Sprintf("SBOM payload suspiciously small (%d bytes)", len(sbom))
		return result, fmt.Errorf("SBOM too small: %d bytes", len(sbom))
	}
	if !sbomHasMarker(sbom) {
		result.FailureReason = "SBOM does not contain SPDX or CycloneDX markers"
		return result, errors.New("SBOM missing SPDX/CycloneDX markers")
	}
	result.SBOMPresent = true
	return result, nil
}

// sbomHasMarker checks for at least one SPDX or CycloneDX marker in the
// raw payload. Mirrors bash csbx:863 — `grep -q -E '"SPDXID"|"spdxVersion"|"bomFormat"'`.
func sbomHasMarker(payload []byte) bool {
	s := string(payload)
	return strings.Contains(s, `"SPDXID"`) ||
		strings.Contains(s, `"spdxVersion"`) ||
		strings.Contains(s, `"bomFormat"`)
}

// ParseRekorURL walks cosign's verify-output JSON looking for a logIndex
// and constructs the canonical Rekor entry URL. Returns "" if the
// payload doesn't contain one. Pure function — no I/O.
//
// cosign emits an array of bundle objects; logIndex lives at:
//   .[].optional.Bundle.Payload.logIndex     (newer cosign)
//   .[].rekorBundle.Payload.logIndex         (older cosign)
//
// The bash version (csbx:695-712) does the same walk in a python heredoc.
func ParseRekorURL(verifyOutput []byte, rekorBaseURL string) string {
	base := strings.TrimRight(rekorBaseURL, "/")
	if base == "" {
		base = strings.TrimRight(DefaultVerifyRekorURL, "/")
	}

	entries := parseAsEntries(verifyOutput)
	for _, e := range entries {
		if logIdx := extractLogIndex(e); logIdx != nil {
			return fmt.Sprintf("%s/api/v1/log/entries?logIndex=%v", base, *logIdx)
		}
	}
	return ""
}

// ParseFulcioSubject walks cosign's verify-output JSON for the Fulcio
// signing identity. Returns "" if not present. Pure function.
//
// Subject is exposed at one of (in order):
//   .[].optional.Subject       (or lowercased "subject")
//   .[].critical.identity.docker-reference (older form)
//
// Mirrors bash csbx:715-737.
func ParseFulcioSubject(verifyOutput []byte) string {
	entries := parseAsEntries(verifyOutput)
	for _, e := range entries {
		if opt, ok := e["optional"].(map[string]any); ok {
			for _, key := range []string{"Subject", "subject"} {
				if s, ok := opt[key].(string); ok && s != "" {
					return s
				}
			}
		}
		if crit, ok := e["critical"].(map[string]any); ok {
			if ident, ok := crit["identity"].(map[string]any); ok {
				if ref, ok := ident["docker-reference"].(string); ok && ref != "" {
					return ref
				}
			}
		}
	}
	return ""
}

// parseAsEntries normalizes cosign's output to a list of entries. cosign
// can emit either a single object or an array depending on flags and
// version; treat both uniformly.
func parseAsEntries(verifyOutput []byte) []map[string]any {
	// cosign output is sometimes wrapped in non-JSON prefix lines (e.g.
	// "Verification for ... --" lines on stderr that get folded into
	// stdout). Try to find the JSON portion by locating the first '['
	// or '{' and parsing from there.
	start := -1
	for i, b := range verifyOutput {
		if b == '{' || b == '[' {
			start = i
			break
		}
	}
	if start == -1 {
		return nil
	}
	body := verifyOutput[start:]

	// Try array first.
	var arr []map[string]any
	if err := json.Unmarshal(body, &arr); err == nil {
		return arr
	}
	// Fall back to single object.
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err == nil {
		return []map[string]any{obj}
	}
	return nil
}

// extractLogIndex pulls the rekor logIndex out of a cosign entry. Returns
// nil if absent. Walks the two known shapes (newer + older cosign).
func extractLogIndex(entry map[string]any) *any {
	// Newer: optional.Bundle.Payload.logIndex
	if opt, ok := entry["optional"].(map[string]any); ok {
		if bundle, ok := opt["Bundle"].(map[string]any); ok {
			if payload, ok := bundle["Payload"].(map[string]any); ok {
				if li, ok := payload["logIndex"]; ok && li != nil {
					return &li
				}
			}
		}
	}
	// Older: rekorBundle.Payload.logIndex
	if rb, ok := entry["rekorBundle"].(map[string]any); ok {
		if payload, ok := rb["Payload"].(map[string]any); ok {
			if li, ok := payload["logIndex"]; ok && li != nil {
				return &li
			}
		}
	}
	return nil
}

// ─── Production Verifier (cosign + docker subprocess) ───────────────

// ExecVerifier shells out to cosign + docker. The single field is a
// Runner so tests can stub the subprocess layer if they want, though
// most tests inject the higher-level Verifier interface instead.
type ExecVerifier struct {
	// Runner is optional; nil means use os/exec directly. Useful for
	// tests that want to inject a fake at the subprocess level rather
	// than the Verifier level.
	Runner Runner
}

// Runner abstracts os/exec.CommandContext for tests.
type Runner interface {
	Run(ctx context.Context, name string, args ...string) (combinedOutput []byte, err error)
}

type osExecRunner struct{}

func (osExecRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func (e *ExecVerifier) runner() Runner {
	if e.Runner != nil {
		return e.Runner
	}
	return osExecRunner{}
}

// NewExecVerifier returns a Verifier that shells out to cosign + docker.
func NewExecVerifier() *ExecVerifier {
	return &ExecVerifier{}
}

func (e *ExecVerifier) CheckPrereqs(ctx context.Context) error {
	if _, err := exec.LookPath("cosign"); err != nil {
		return fmt.Errorf("%w: cosign not in PATH (install from https://docs.sigstore.dev/cosign/installation/)", ErrPrereqMissing)
	}
	if _, err := exec.LookPath("docker"); err != nil {
		return fmt.Errorf("%w: docker not in PATH (needed to resolve image digests + inspect SBOM)", ErrPrereqMissing)
	}
	return nil
}

func (e *ExecVerifier) ResolveDigest(ctx context.Context, ref string) (string, error) {
	if i := strings.Index(ref, "@sha256:"); i >= 0 {
		return ref[i+1:], nil
	}
	// Try docker buildx imagetools first — no pull required.
	out, err := e.runner().Run(ctx, "docker", "buildx", "imagetools", "inspect", ref, "--format", "{{ .Manifest.Digest }}")
	if err == nil {
		digest := strings.TrimSpace(string(out))
		if strings.HasPrefix(digest, "sha256:") {
			return digest, nil
		}
	}
	// Fall back to RepoDigests on a locally pulled image.
	out2, err2 := e.runner().Run(ctx, "docker", "image", "inspect", ref, "--format", "{{range .RepoDigests}}{{println .}}{{end}}")
	if err2 == nil {
		for _, line := range strings.Split(string(out2), "\n") {
			line = strings.TrimSpace(line)
			if i := strings.Index(line, "@sha256:"); i >= 0 {
				return line[i+1:], nil
			}
		}
	}
	return "", fmt.Errorf("could not resolve digest for %q (try: docker pull %s)", ref, ref)
}

func (e *ExecVerifier) CosignVerify(ctx context.Context, pinned, identityRegex, oidcIssuer string) ([]byte, error) {
	out, err := e.runner().Run(ctx, "cosign", "verify", pinned,
		"--certificate-identity-regexp", identityRegex,
		"--certificate-oidc-issuer", oidcIssuer)
	if err != nil {
		return out, fmt.Errorf("cosign verify failed: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}
	return out, nil
}

func (e *ExecVerifier) InspectSBOM(ctx context.Context, pinned string) ([]byte, error) {
	out, err := e.runner().Run(ctx, "docker", "buildx", "imagetools", "inspect", pinned, "--format", "{{ json .SBOM }}")
	if err != nil {
		return out, fmt.Errorf("docker buildx imagetools inspect SBOM failed: %w", err)
	}
	return out, nil
}
