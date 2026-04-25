package csbx

import (
	"fmt"
	"io"
	"os"
	"sort"
	"text/tabwriter"

	"github.com/spf13/cobra"

	csbxstate "github.com/ProwlrBot/CyberBox/cli/internal/csbx"
)

func newListCmd() *cobra.Command {
	var available bool

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List installed plugins (or --available for the full registry)",
		Long: `Print a table of installed plugins, one per row.

With --available, prints the full registry catalog instead — equivalent
to 'csbx search' with no query.`,
		Example: `  cyberbox csbx list
  cyberbox csbx list --available`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runList(available, os.Stdout, os.Stderr)
		},
	}
	cmd.Flags().BoolVar(&available, "available", false, "List all registry plugins instead of installed")
	return cmd
}

// runList is the testable core. EnsureDirs is called on every run so a
// fresh $CSBX_HOME boots correctly without requiring `csbx doctor`
// first — matches bash csbx, which calls ensure_dirs at the top of the
// dispatcher (line 931).
func runList(available bool, stdout, stderr io.Writer) error {
	paths, err := csbxstate.NewPaths()
	if err != nil {
		return err
	}
	if err := paths.EnsureDirs(); err != nil {
		return err
	}

	if available {
		return listAvailable(paths, stdout, stderr)
	}
	return listInstalled(paths, stdout)
}

func listInstalled(paths *csbxstate.Paths, stdout io.Writer) error {
	inst, err := paths.LoadInstalled()
	if err != nil {
		return err
	}
	fmt.Fprintln(stdout, "Installed plugins:")
	if len(inst.Plugins) == 0 {
		fmt.Fprintln(stdout, "  (none — try: cyberbox csbx install seclists)")
		return nil
	}
	names := sortedKeys(inst.Plugins)
	tw := tabwriter.NewWriter(stdout, 0, 0, 2, ' ', 0)
	for _, name := range names {
		entry := inst.Plugins[name]
		fmt.Fprintf(tw, "  %s\t%s\t%s\n", name, entry.Type, entry.Path)
	}
	return tw.Flush()
}

func listAvailable(paths *csbxstate.Paths, stdout, stderr io.Writer) error {
	reg, err := paths.LoadRegistry()
	if err != nil {
		return err
	}
	if len(reg.Plugins) == 0 {
		fmt.Fprintln(stderr, "Registry is empty or not synced — try: cyberbox csbx sync (when phase 3-3 lands)")
		return nil
	}
	fmt.Fprintln(stdout, "Available plugins:")
	names := sortedRegistryKeys(reg.Plugins)
	tw := tabwriter.NewWriter(stdout, 0, 0, 2, ' ', 0)
	for _, name := range names {
		entry := reg.Plugins[name]
		fmt.Fprintf(tw, "  %s\t%s\t%s\t%s\n", name, entry.Type, entry.Size, entry.Description)
	}
	return tw.Flush()
}

func sortedKeys(m map[string]csbxstate.InstalledEntry) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedRegistryKeys(m map[string]csbxstate.RegistryEntry) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
