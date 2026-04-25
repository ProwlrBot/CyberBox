package csbx

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"

	csbxstate "github.com/ProwlrBot/CyberBox/cli/internal/csbx"
)

func newPdtmCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "pdtm <manifest.yaml | go-install-path>",
		Short: "Install a Go tool via 'go install' (projectdiscovery/pdtm-compatible)",
		Long: `Install a single Go binary into ~/.csbx/bin/ via 'go install'.
Accepts either a manifest YAML file (with name, repo, install_type, go_install_path,
version fields) or a bare Go install path like
github.com/projectdiscovery/subfinder/v2/cmd/subfinder.

Records the result in installed.yaml with source: pdtm so 'csbx update'
can later distinguish pdtm tools from git-cloned plugins.

Requires the 'go' toolchain in PATH; honors the user's GOSUMDB,
GOPROXY, GOPRIVATE settings (the binary does NOT bundle a Go
toolchain).`,
		Example: `  cyberbox csbx pdtm github.com/projectdiscovery/subfinder/v2/cmd/subfinder
  cyberbox csbx pdtm tools/subfinder.yaml
  cyberbox csbx pdtm github.com/ffuf/ffuf/v2@v2.1.0`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runPdtm(cmd.Context(), &csbxstate.ExecGoInstaller{}, args[0], os.Stdout, os.Stderr)
		},
	}
}

// runPdtm is the testable core. The cobra wrapper passes a real
// ExecGoInstaller; tests inject a fake.
func runPdtm(ctx context.Context, installer csbxstate.GoInstaller, arg string, stdout, stderr io.Writer) error {
	in, err := csbxstate.ParsePdtmInput(arg, os.ReadFile, yaml.Unmarshal)
	if err != nil {
		fmt.Fprintf(stderr, "[x] %s\n", err)
		return err
	}

	paths, err := csbxstate.NewPaths()
	if err != nil {
		return err
	}

	fmt.Fprintf(stdout, "[+] Installing %s via: go install %s@%s\n", in.Name, in.GoInstallPath, in.Version)

	target, err := csbxstate.PdtmInstall(ctx, paths, installer, in)
	if err != nil {
		if errors.Is(err, csbxstate.ErrPrereqMissing) {
			fmt.Fprintf(stderr, "[x] %s\n", err)
		} else {
			fmt.Fprintf(stderr, "[x] %s\n", err)
		}
		return err
	}

	fmt.Fprintf(stdout, "[✓] %s installed → %s\n", in.Name, target)
	return nil
}
