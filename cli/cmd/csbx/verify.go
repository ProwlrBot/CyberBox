package csbx

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"

	csbxstate "github.com/ProwlrBot/CyberBox/cli/internal/csbx"
)

// verifyExitCode is the exit code returned by `csbx verify`. The bash
// version uses 0 / 1 / 2 with these exact meanings, and downstream
// shell scripts are baked against them — preserve verbatim.
const (
	verifyExitOK            = 0 // signed, transparency-logged, SBOM present (or skipped)
	verifyExitFailed        = 1 // unsigned / tampered / verification failed
	verifyExitPrereqMissing = 2 // cosign or docker not in PATH
)

func newVerifyCmd() *cobra.Command {
	cfg := &csbxstate.VerifyConfig{}

	cmd := &cobra.Command{
		Use:   "verify [flags]",
		Short: "Cosign keyless signature + SBOM check on a cybersandbox image",
		Long: `Run the same cosign keyless signature check, SBOM presence
inspection, and Rekor transparency-log lookup that the CI
verify-supply-chain job runs, against any locally pulled cybersandbox
image. Exits 0 on full pass, 1 on verification failure, 2 if cosign or
docker isn't installed.

Underlying command (audit the wrapper):
  cosign verify <image>@<digest> \
    --certificate-identity-regexp '<identity-regex>' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com`,
		Example: `  cyberbox csbx verify
  cyberbox csbx verify --tag sha-abc1234
  cyberbox csbx verify --ref ghcr.io/prowlrbot/cybersandbox@sha256:deadbeef...
  cyberbox csbx verify --skip-sbom`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			v := csbxstate.NewExecVerifier()
			code := runVerify(ctx, v, *cfg, os.Stdout, os.Stderr)
			if code == 0 {
				return nil
			}
			// Use SilenceErrors at the parent level + os.Exit here so the
			// exit code is exactly 0/1/2 — cobra otherwise overrides
			// with its own non-zero codes.
			os.Exit(code)
			return nil // unreachable
		},
	}

	cmd.Flags().StringVar(&cfg.Image, "image", "", "Image repo (default: "+csbxstate.DefaultVerifyImage+")")
	cmd.Flags().StringVar(&cfg.Tag, "tag", "", "Tag (default: "+csbxstate.DefaultVerifyTag+"); ignored if --ref is set")
	cmd.Flags().StringVar(&cfg.Ref, "ref", "", "Explicit reference (repo:tag or repo@sha256:...); overrides --image/--tag")
	cmd.Flags().StringVar(&cfg.IdentityRegex, "identity", "", "cosign --certificate-identity-regexp (default pinned to cybersandbox-build.yml)")
	cmd.Flags().StringVar(&cfg.OIDCIssuer, "oidc-issuer", "", "cosign --certificate-oidc-issuer (default: GitHub Actions token issuer)")
	cmd.Flags().BoolVar(&cfg.SkipSBOM, "skip-sbom", false, "Skip the SBOM presence + format check")
	cmd.Flags().BoolVar(&cfg.SkipRekor, "skip-rekor", false, "Skip the Rekor URL line in the success report (cosign still hits Rekor)")
	return cmd
}

// runVerify is the testable core. The cobra wrapper passes a real
// ExecVerifier; tests inject a fake. Returns the exit code so the
// cobra wrapper can call os.Exit verbatim.
func runVerify(ctx context.Context, v csbxstate.Verifier, cfg csbxstate.VerifyConfig, stdout, stderr io.Writer) int {
	// Apply defaults so the printed report shows what was actually checked.
	repo := cfg.Image
	if repo == "" {
		repo = csbxstate.DefaultVerifyImage
	}
	tag := cfg.Tag
	if tag == "" {
		tag = csbxstate.DefaultVerifyTag
	}
	ref := cfg.Ref
	if ref == "" {
		ref = repo + ":" + tag
	}
	fmt.Fprintf(stdout, "[+] Verifying %s\n", ref)

	res, err := csbxstate.Verify(ctx, v, cfg)

	// Prereq missing is a special exit code.
	if errors.Is(err, csbxstate.ErrPrereqMissing) {
		fmt.Fprintf(stderr, "[x] %s\n", err)
		return verifyExitPrereqMissing
	}

	if res == nil {
		// Shouldn't happen — Verify always returns a partial result —
		// but be defensive.
		fmt.Fprintf(stderr, "[x] verification produced no result: %v\n", err)
		return verifyExitFailed
	}

	if !res.Signed {
		fmt.Fprintf(stderr, "[x] %s\n", res.FailureReason)
		if err != nil {
			fmt.Fprintf(stderr, "    %s\n", err)
		}
		fmt.Fprintln(stderr, "    Possible causes:")
		fmt.Fprintln(stderr, "      - image was published before keyless signing was enabled")
		fmt.Fprintln(stderr, "      - tag points at a tampered/unsigned digest (refuse to use it)")
		fmt.Fprintln(stderr, "      - identity regex does not match — verify the build workflow URL")
		return verifyExitFailed
	}
	fmt.Fprintf(stdout, "[✓] Resolved digest: %s\n", res.Digest)
	fmt.Fprintln(stdout, "[✓] cosign signature: VALID")

	if !cfg.SkipSBOM {
		if !res.SBOMPresent {
			fmt.Fprintf(stderr, "[x] %s\n", res.FailureReason)
			return verifyExitFailed
		}
		fmt.Fprintf(stdout, "[✓] SBOM present (%d bytes, SPDX/CycloneDX)\n", res.SBOMSize)
	}

	// Final pass report (mirrors bash csbx:877-887).
	fmt.Fprintln(stdout)
	fmt.Fprintln(stdout, "Supply-chain verification: PASS")
	fmt.Fprintf(stdout, "  image:   %s\n", res.Repo)
	fmt.Fprintf(stdout, "  digest:  %s\n", res.Digest)
	if res.FulcioSubject != "" {
		fmt.Fprintf(stdout, "  signer:  %s\n", res.FulcioSubject)
	}
	if !cfg.SkipRekor && res.RekorURL != "" {
		fmt.Fprintf(stdout, "  rekor:   %s\n", res.RekorURL)
	}
	// Fulcio search URL (always included; nice for ad-hoc audit)
	if digestSuffix := stripSHA256Prefix(res.Digest); digestSuffix != "" {
		fmt.Fprintf(stdout, "  fulcio:  https://search.sigstore.dev/?hash=%s\n", digestSuffix)
	}
	fmt.Fprintln(stdout)
	return verifyExitOK
}

// stripSHA256Prefix returns the hex part of a sha256: digest, or the
// input unchanged if no prefix. Mirrors bash csbx:885 (`${digest#sha256:}`).
// "sha256:" alone (no hex) returns "" — that's what bash's `${var#prefix}`
// would produce.
func stripSHA256Prefix(digest string) string {
	const prefix = "sha256:"
	if len(digest) >= len(prefix) && digest[:len(prefix)] == prefix {
		return digest[len(prefix):]
	}
	return digest
}
