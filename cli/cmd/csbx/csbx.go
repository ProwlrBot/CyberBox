// Package csbx is the cobra subcommand subtree for cybersandbox plugin
// management. Spec 018 phase 3-2a landed the read-only subcommands
// (search, info, list, doctor); phase 3-2c adds verify (cosign + docker
// subprocess); phase 3-3 will add the mutating subcommands.
//
// Each subcommand lives in its own file (search.go, info.go, list.go,
// doctor.go, verify.go) so the surface stays browseable. NewCmd is the
// only exported symbol — it wires the subtree onto the parent cobra
// root.
package csbx

import (
	"github.com/spf13/cobra"
)

// NewCmd returns the `cyberbox csbx ...` root with the read-only
// subcommands plus verify registered. Mutating subcommands (install,
// remove, update, sync, pdtm) will register here as they're ported in
// phase 3-3.
func NewCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "csbx",
		Short: "Plugin manager for CyberSandbox",
		Long: `csbx — CyberSandbox plugin manager.

Phases 3-2a (search/info/list/doctor) and 3-2c (verify) ship the
read-only subcommands. Mutating subcommands (install/remove/update/
sync/pdtm) still resolve to the legacy bash 'csbx' file via the
subcommand-not-found redirect until phase 3-3 lands them in Go too.`,
		// SilenceUsage on subcommand errors — error message is enough,
		// don't dump the whole usage block on every failure.
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	cmd.AddCommand(newSearchCmd())
	cmd.AddCommand(newInfoCmd())
	cmd.AddCommand(newListCmd())
	cmd.AddCommand(newDoctorCmd())
	cmd.AddCommand(newVerifyCmd()) // phase 3-2c: cosign + docker subprocess
	cmd.AddCommand(newPdtmCmd())   // phase 3-3c: go install subprocess
	return cmd
}
