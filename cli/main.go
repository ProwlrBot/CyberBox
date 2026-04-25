// cyberbox is the unified Go-native CLI replacement for the bash csbx,
// harbinger, invoke-claude, and invoke-ollama scripts. See cli/README.md
// for the migration plan; only invoke-claude is fully ported in Phase 1.
package main

import (
	"os"

	"github.com/ProwlrBot/CyberBox/cli/cmd"
)

func main() {
	if err := cmd.Execute(); err != nil {
		os.Exit(1)
	}
}
