package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// notYetPorted writes a helpful redirect to stderr and exits 2 so callers
// can distinguish "feature unimplemented" (2) from "operation failed" (1).
//
// Phases 1 (invoke-claude), 2 (invoke-ollama), and 3-2a (csbx read-only)
// each replaced their stub with a real implementation. Only harbinger
// remains as a redirect-stub until its port lands in a follow-up phase.
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

// newCsbxCmd was a full stub; phase 3-2a replaced it with a real cobra
// subtree at cli/cmd/csbx/. The wiring in cli/cmd/root.go calls
// csbxcmd.NewCmd() directly.
//
// newInvokeOllamaCmd was a stub in Phase 1; phase 2 replaced it with
// the real implementation in invoke_ollama.go (same function name, real
// cobra.Command). cli/cmd/root.go still calls newInvokeOllamaCmd() —
// which now resolves to the real one defined in invoke_ollama.go.

func newHarbingerCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "harbinger [args]...",
		Short:              "(stub) Phase-driven security testing CLI",
		DisableFlagParsing: true,
		Run:                notYetPorted("harbinger", "harbinger/bin/harbinger"),
	}
}
