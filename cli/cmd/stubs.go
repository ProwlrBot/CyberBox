package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// notYetPorted writes a helpful redirect to stderr and exits 2 so callers
// can distinguish "feature unimplemented" (2) from "operation failed" (1).
//
// Phase 1 of spec 018 ships only invoke-claude as a real port. The other
// three subcommands register so `cyberbox --help` lists the full surface,
// but invoking them prints a pointer to the legacy bash file. This keeps
// users out of "command not found" rabbit holes during the migration.
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

func newInvokeOllamaCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "invoke-ollama [args]...",
		Short:              "(stub) Send prompts to a local Ollama instance",
		DisableFlagParsing: true,
		Run:                notYetPorted("invoke-ollama", "harbinger/bin/invoke-ollama"),
	}
}
