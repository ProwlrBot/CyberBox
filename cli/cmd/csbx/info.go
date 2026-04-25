package csbx

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	csbxstate "github.com/ProwlrBot/CyberBox/cli/internal/csbx"
)

func newInfoCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "info <plugin>",
		Short: "Show plugin details from the registry plus install status",
		Long: `Pretty-print one plugin's registry entry alongside its
install status (path + installed-at timestamp from installed.yaml, or
'Not installed').

Read-only. Exits 0 even when the plugin is unknown — the printed
message tells the user, the exit code distinguishes "operational error"
from "informational answer".`,
		Example: `  cyberbox csbx info seclists
  cyberbox csbx info nuclei-templates`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runInfo(args[0], os.Stdout, os.Stderr)
		},
	}
}

func runInfo(name string, stdout, stderr io.Writer) error {
	if err := csbxstate.ValidateName(name); err != nil {
		fmt.Fprintf(stderr, "[x] %s\n", err)
		return err
	}
	paths, err := csbxstate.NewPaths()
	if err != nil {
		return err
	}
	if err := paths.EnsureDirs(); err != nil {
		return err
	}

	reg, err := paths.LoadRegistry()
	if err != nil {
		return err
	}
	entry, ok := reg.Plugins[name]
	if !ok {
		// Match bash csbx:225 — red "[x] Plugin "name" not in registry",
		// return 0. This is a "user-information" path, not a fatal.
		fmt.Fprintf(stdout, "[x] Plugin %q not in registry\n", name)
		return nil
	}

	fmt.Fprintf(stdout, " %s\n", name)
	fmt.Fprintf(stdout, "  Type:        %s\n", coalesce(entry.Type, "?"))
	fmt.Fprintf(stdout, "  Description: %s\n", coalesce(entry.Description, "?"))
	fmt.Fprintf(stdout, "  Repo:        %s\n", coalesce(entry.Repo, "?"))
	fmt.Fprintf(stdout, "  Size:        %s\n", coalesce(entry.Size, "?"))
	fmt.Fprintf(stdout, "  Tags:        %s\n", joinTags(entry.Tags))

	inst, err := paths.LoadInstalled()
	if err != nil {
		return err
	}
	if iEntry, isInstalled := inst.Plugins[name]; isInstalled {
		fmt.Fprintf(stdout, "  Installed:   %s at %s\n",
			coalesce(iEntry.InstalledAt, "?"),
			coalesce(iEntry.Path, "?"))
	} else {
		fmt.Fprintln(stdout, "  Not installed")
	}
	return nil
}

func coalesce(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func joinTags(tags []string) string {
	if len(tags) == 0 {
		return "(none)"
	}
	return strings.Join(tags, ", ")
}
