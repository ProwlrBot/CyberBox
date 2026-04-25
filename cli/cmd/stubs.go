package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// notYetPorted writes a helpful redirect to stderr and exits 2 so callers
// can distinguish "feature unimplemented" (2) from "operation failed" (1).
//
// Phase 1 of spec 018 shipped invoke-claude as a real port. Phase 3-2a
// ships csbx's read-only subcommands (search/info/list/doctor — see
// cli/cmd/csbx/). The remaining subcommands (invoke-ollama as a fully
// integrated stub, harbinger entirely) register so `cyberbox --help`
// lists the full surface, but invoking them prints a pointer to the
// legacy bash file. This keeps users out of "command not found" rabbit
// holes during the migration.
func notYetPorted(name, bashPath string) func(cmd *cobra.Command, args []string) {
	return func(cmd *cobra.Command, args []string) {
		fmt.Fprintf(os.Stderr,
			"%s: not yet ported to the Go binary.\n"+
				"In the meantime, run:  %s %s\n"+
				"See cli/README.md for the migration plan.\n",
			name, bashPath, joinArgs(args))
		os.Exit(2)
	}
}

func joinArgs(args []string) string {
	out := ""
	for i, a := range args {
		if i > 0 {
			out += " "
		}
		out += a
	}
	return out
}

// newCsbxCmd was a full stub; phase 3-2a replaces it with a real cobra
// subtree at cli/cmd/csbx/ that handles search/info/list/doctor and
// returns a 'not yet ported' redirect for the mutating subcommands
// (install/remove/update/sync/pdtm/verify). The wiring lives in
// cli/cmd/root.go which now calls csbxcmd.NewCmd() directly.

func newHarbingerCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "harbinger [args]...",
		Short:              "(stub) Phase-driven security testing CLI",
		DisableFlagParsing: true,
		Run:                notYetPorted("harbinger", "harbinger/bin/harbinger"),
	}
}

func newInvokeOllamaCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "invoke-ollama [args]...",
		Short:              "(stub) Send prompts to a local Ollama instance",
		DisableFlagParsing: true,
		Run:                notYetPorted("invoke-ollama", "harbinger/bin/invoke-ollama"),
	}
}
