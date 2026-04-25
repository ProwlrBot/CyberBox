package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// notYetPorted writes a helpful redirect to stderr and exits 2 so callers
// can distinguish "feature unimplemented" (2) from "operation failed" (1).
//
// Phase 1 of spec 018 shipped invoke-claude as a real port. Phase 2
// adds invoke-ollama (see invoke_ollama.go). The remaining two
// subcommands (csbx, harbinger) register so `cyberbox --help` lists the
// full surface, but invoking them prints a pointer to the legacy bash
// file. This keeps users out of "command not found" rabbit holes during
// the migration.
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

func newCsbxCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "csbx [args]...",
		Short:              "(stub) Plugin manager for CyberSandbox",
		DisableFlagParsing: true, // pass-through to the bash script
		Run:                notYetPorted("csbx", "harbinger/bin/csbx"),
	}
}

func newHarbingerCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "harbinger [args]...",
		Short:              "(stub) Phase-driven security testing CLI",
		DisableFlagParsing: true,
		Run:                notYetPorted("harbinger", "harbinger/bin/harbinger"),
	}
}

// newInvokeOllamaCmd was a stub in Phase 1; its real implementation
// lives in invoke_ollama.go starting Phase 2. Kept here as a comment so
// `git blame` makes the transition discoverable. The cobra registration
// in root.go calls the real constructor now.
