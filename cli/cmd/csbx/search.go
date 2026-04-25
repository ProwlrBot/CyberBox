package csbx

import (
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"

	csbxstate "github.com/ProwlrBot/CyberBox/cli/internal/csbx"
)

func newSearchCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "search [query]",
		Short: "Search the registry by name, description, or tag",
		Long: `Search the cached upstream registry for plugins whose name,
description, or tag matches QUERY (case-insensitive substring). Empty
QUERY lists all plugins.

Read-only. If no registry is cached yet, prints a hint to run sync (or
returns an empty list quietly when phase 3-3 lands sync).`,
		Example: `  cyberbox csbx search             # list all
  cyberbox csbx search xss         # by tag/description
  cyberbox csbx search seclists    # by name`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			query := ""
			if len(args) == 1 {
				query = args[0]
			}
			return runSearch(query, os.Stdout, os.Stderr)
		},
	}
}

func runSearch(query string, stdout, stderr io.Writer) error {
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
	if len(reg.Plugins) == 0 {
		// Same fallback hint as bash csbx — without a cached registry,
		// search has nothing to look at. Don't auto-sync; that's the
		// user's choice (will be 'cyberbox csbx sync' once phase 3-3 lands).
		fmt.Fprintln(stderr, "Registry not synced. Run 'cyberbox csbx sync' (or use the legacy bash 'csbx sync' until phase 3-3 lands).")
		return nil
	}

	q := strings.ToLower(query)
	names := make([]string, 0, len(reg.Plugins))
	for name := range reg.Plugins {
		names = append(names, name)
	}
	sort.Strings(names)

	tw := tabwriter.NewWriter(stdout, 0, 0, 2, ' ', 0)
	matched := 0
	for _, name := range names {
		entry := reg.Plugins[name]
		if !matches(name, entry, q) {
			continue
		}
		fmt.Fprintf(tw, "  %s\t%s\t%s\t%s\n",
			name, entry.Type, entry.Size, truncDesc(entry.Description, 60))
		matched++
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	if matched == 0 && q != "" {
		fmt.Fprintf(stderr, "No plugins matched %q.\n", query)
	}
	return nil
}

func matches(name string, entry csbxstate.RegistryEntry, lowerQuery string) bool {
	if lowerQuery == "" {
		return true
	}
	hay := strings.ToLower(name) + " " + strings.ToLower(entry.Description) + " " + strings.ToLower(strings.Join(entry.Tags, " "))
	return strings.Contains(hay, lowerQuery)
}

func truncDesc(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
