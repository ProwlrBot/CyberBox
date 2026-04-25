package cmd

import (
	"github.com/spf13/cobra"
)

// Version is set at link time via -ldflags. Defaults to "dev" for unreleased
// builds (go build with no flags).
var Version = "dev"

func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "cyberbox",
		Short: "CyberBox unified CLI (csbx + harbinger + invoke-* in one binary)",
		Long: `cyberbox is the Go-native replacement for the legacy bash CLIs.

Subcommands:
  invoke-claude    Send prompts to the Anthropic Messages API (PORTED)
  invoke-ollama    Send prompts to a local Ollama instance    (PORTED)
  csbx             Plugin manager for CyberSandbox             (stub)
  harbinger        Phase-driven security testing CLI           (stub)

Stubs print a redirect to the equivalent bash script. The full port
lands incrementally. See cli/README.md for the migration plan.`,
		Version:       Version,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	root.AddCommand(newInvokeClaudeCmd())
	root.AddCommand(newInvokeOllamaCmd())
	root.AddCommand(newCsbxCmd())
	root.AddCommand(newHarbingerCmd())
	return root
}

// Execute runs the root command. main() exits non-zero on a returned error;
// individual subcommands also use os.Exit() for fine-grained codes.
func Execute() error {
	return newRootCmd().Execute()
}
