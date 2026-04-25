package csbx

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"

	csbxstate "github.com/ProwlrBot/CyberBox/cli/internal/csbx"
)

func newSyncCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "sync",
		Short: "Force-refresh the cached registry from CSBX_REGISTRY_URL",
		Long: `Download CSBX_REGISTRY_URL into ~/.csbx/registry.yaml. Atomic
write — a partial download cannot corrupt the cached copy.

Fallback behaviour matches the bash csbx:
  remote success    → "Registry synced (remote)"
  remote fails, cache exists → keeps cache, prints warning
  cold start, no network    → writes embedded baseline (10 default plugins)`,
		Example: `  cyberbox csbx sync
  CSBX_REGISTRY_URL=https://my-mirror.example.com/csbx/registry.yaml cyberbox csbx sync`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runSync(cmd.Context(), csbxstate.NewHTTPFetcher(), os.Stdout, os.Stderr)
		},
	}
}

// runSync is the testable core. The cobra wrapper passes a real
// HTTPFetcher; tests inject a fake.
func runSync(ctx context.Context, f csbxstate.SyncFetcher, stdout, stderr io.Writer) error {
	paths, err := csbxstate.NewPaths()
	if err != nil {
		return err
	}
	res, err := csbxstate.Sync(ctx, paths, f)
	if err != nil {
		fmt.Fprintf(stderr, "[x] sync failed: %s\n", err)
		return err
	}

	switch res.Source {
	case "remote":
		fmt.Fprintf(stdout, "[✓] Registry synced from %s\n", res.URL)
	case "cached":
		fmt.Fprintf(stderr, "[!] %s unreachable (%s); keeping cached %s\n",
			res.URL, res.Err, res.Path)
	case "baseline":
		fmt.Fprintf(stderr, "[!] %s unreachable (%s); wrote embedded baseline to %s\n",
			res.URL, res.Err, res.Path)
		fmt.Fprintln(stderr, "    The baseline ships 10 default plugins; run sync again when network is available.")
	}
	return nil
}
