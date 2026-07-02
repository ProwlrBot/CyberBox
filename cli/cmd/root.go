package cmd

import (
	"github.com/spf13/cobra"

	csbxcmd "github.com/ProwlrBot/CyberBox/cli/cmd/csbx"
)

// Version is set at link time via -ldflags. Defaults to "dev" for unreleased
// builds (go build with no flags).
var Version = "dev"

func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "cyberbox",
		Short: "CyberBox unified CLI (csbx + prowl + invoke-* in one binary)",
		Long: `cyberbox is the Go-native replacement for the legacy bash CLIs.

Subcommands:
  invoke-claude    Send prompts to the Anthropic Messages API (PORTED)
  invoke-ollama    Send prompts to a local Ollama instance    (PORTED)
  csbx             Plugin manager for CyberSandbox             (PARTIAL — read-only + verify ported)
  prowl            Phase-driven security testing CLI           (stub; harbinger alias)

Stubs print a redirect to the equivalent bash script. csbx PARTIAL
means search/info/list/doctor are real Go implementations; install/
remove/update/sync/pdtm/verify still resolve to bash via the
not-yet-ported message. The full port lands incrementally — see
cli/README.md for the migration plan.`,
		Version:       Version,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	root.AddCommand(newInvokeClaudeCmd())
	root.AddCommand(newInvokeOllamaCmd())
	root.AddCommand(csbxcmd.NewCmd()) // search/info/list/doctor are real; mutating subcommands fall through to the legacy bash csbx
	root.AddCommand(newProwlCmd())
	return root
}

// Execute runs the root command. main() exits non-zero on a returned error;
// individual subcommands also use os.Exit() for fine-grained codes.
func Execute() error {
	return newRootCmd().Execute()
}
