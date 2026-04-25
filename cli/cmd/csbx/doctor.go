package csbx

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/spf13/cobra"

	csbxstate "github.com/ProwlrBot/CyberBox/cli/internal/csbx"
)

func newDoctorCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "doctor",
		Short: "Health check ($CSBX_HOME layout, broken symlinks, prereqs, plugin count)",
		Long: `Reports on the health of $CSBX_HOME — directory layout,
broken symlinks under bin/, presence of git in PATH (needed for install /
update), the count of installed plugins, and total plugin storage.

Read-only. Useful as a smoke test after a fresh install or before
filing an issue.`,
		Example: `  cyberbox csbx doctor`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runDoctor(os.Stdout, os.Stderr)
		},
	}
}

// runDoctor walks $CSBX_HOME, prints structured status lines (one per
// check) so a downstream parser can scrape pass/fail. The bash test
// suite asserts existence of the [+]/[✓]/[!] markers — reproduce them
// verbatim so the bash regression test passes when the bash file
// becomes a shim.
func runDoctor(stdout, stderr io.Writer) error {
	paths, err := csbxstate.NewPaths()
	if err != nil {
		return err
	}
	if err := paths.EnsureDirs(); err != nil {
		return err
	}

	fmt.Fprintln(stdout, "CyberSandbox Health Check")
	fmt.Fprintln(stdout)

	// 1) Directory tree
	for _, dir := range []string{paths.Home, paths.Bin, paths.Plugins} {
		if statIsDir(dir) {
			fmt.Fprintf(stdout, "[✓] %s\n", dir)
		} else {
			fmt.Fprintf(stdout, "[!] %s missing\n", dir)
		}
	}

	// 2) Broken symlinks under bin/. Walk only top-level entries — same
	// semantics as bash `for link in "$CSBX_BIN"/*`.
	broken := 0
	binEntries, err := os.ReadDir(paths.Bin)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		fmt.Fprintf(stdout, "[!] cannot read %s: %v\n", paths.Bin, err)
	} else {
		for _, e := range binEntries {
			full := filepath.Join(paths.Bin, e.Name())
			info, err := os.Lstat(full)
			if err != nil || info.Mode()&os.ModeSymlink == 0 {
				continue
			}
			if _, err := os.Stat(full); err != nil {
				fmt.Fprintf(stdout, "[!] Broken symlink: %s\n", full)
				broken++
			}
		}
	}
	if broken == 0 {
		fmt.Fprintln(stdout, "[✓] No broken symlinks")
	}

	// 3) git availability (needed for install/update). pyyaml from the
	// bash version is no longer relevant — Go binary self-contains
	// gopkg.in/yaml.v3.
	if _, err := exec.LookPath("git"); err == nil {
		fmt.Fprintln(stdout, "[✓] git available")
	} else {
		fmt.Fprintln(stdout, "[x] git missing")
	}

	// 4) Stats
	fmt.Fprintln(stdout)
	inst, err := paths.LoadInstalled()
	if err != nil {
		fmt.Fprintf(stdout, "[+] cannot read installed.yaml: %v\n", err)
	} else {
		fmt.Fprintf(stdout, "[+] %d plugin(s) installed\n", len(inst.Plugins))
	}

	size := dirSize(paths.Plugins)
	fmt.Fprintf(stdout, "[+] Plugin storage: %s\n", humanSize(size))
	return nil
}

func statIsDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func dirSize(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // skip permission errors quietly
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}

// humanSize formats `bytes` the way `du -sh` would — one decimal at the
// largest sensible unit. Matches the bash `du -sh ... | cut -f1` shape
// closely enough that the test_csbx.sh `[8] doctor` regex is happy.
func humanSize(bytes int64) string {
	const k = 1024
	switch {
	case bytes < k:
		return fmt.Sprintf("%dB", bytes)
	case bytes < k*k:
		return fmt.Sprintf("%.1fK", float64(bytes)/k)
	case bytes < k*k*k:
		return fmt.Sprintf("%.1fM", float64(bytes)/(k*k))
	default:
		return fmt.Sprintf("%.1fG", float64(bytes)/(k*k*k))
	}
}
