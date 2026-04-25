package csbx

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"strings"
	"time"
)

// PdtmManifest is the YAML schema for csbx pdtm <manifest.yaml>.
// Mirrors the projectdiscovery/pdtm tool entry shape.
type PdtmManifest struct {
	Name          string `yaml:"name"`
	Repo          string `yaml:"repo"`
	InstallType   string `yaml:"install_type"` // "go" today; "binary" reserved
	GoInstallPath string `yaml:"go_install_path"`
	Version       string `yaml:"version"`
}

// PdtmInput is what runPdtm has to work with after parsing the user
// argument. Construct via ParsePdtmInput.
type PdtmInput struct {
	Name          string
	Repo          string
	InstallType   string
	GoInstallPath string
	Version       string
	// Source tracks where the input came from for the error messages.
	// Either "manifest:<path>" or "go-path:<arg>".
	Source string
}

// ParsePdtmInput decides whether `arg` is a manifest file or a bare
// Go install path. Mirrors bash csbx:578-594. Validates the resulting
// `Name` so the caller doesn't have to.
//
// `readFile` is injected for testability — production passes os.ReadFile.
func ParsePdtmInput(arg string, readFile func(string) ([]byte, error), unmarshal func([]byte, any) error) (*PdtmInput, error) {
	if arg == "" {
		return nil, errors.New("empty argument; pass a manifest YAML or a Go install path")
	}

	// Manifest-file detection: try reading; if it parses as YAML with at
	// least a name or go_install_path, treat as manifest.
	if data, err := readFile(arg); err == nil {
		var m PdtmManifest
		if uerr := unmarshal(data, &m); uerr == nil && (m.Name != "" || m.GoInstallPath != "") {
			pi := &PdtmInput{
				Name:          m.Name,
				Repo:          m.Repo,
				InstallType:   m.InstallType,
				GoInstallPath: m.GoInstallPath,
				Version:       m.Version,
				Source:        "manifest:" + arg,
			}
			pi.applyDefaults()
			if err := ValidateName(pi.Name); err != nil {
				return pi, err
			}
			return pi, nil
		}
	}

	// Bare Go install path: must contain at least two slashes (e.g.
	// github.com/org/tool/cmd/tool) or start with github.com/. Same
	// heuristic as bash csbx:585.
	if isGoInstallPath(arg) {
		name := path.Base(arg)
		// Strip any @version suffix the user may have included.
		if at := strings.Index(name, "@"); at >= 0 {
			name = name[:at]
		}
		// Strip any @version suffix from the install path itself for
		// recording purposes; we'll re-add it from Version.
		goPath := arg
		version := "latest"
		if at := strings.Index(arg, "@"); at >= 0 {
			goPath = arg[:at]
			version = arg[at+1:]
			if version == "" {
				version = "latest"
			}
		}
		pi := &PdtmInput{
			Name:          name,
			InstallType:   "go",
			GoInstallPath: goPath,
			Version:       version,
			Source:        "go-path:" + arg,
		}
		if err := ValidateName(pi.Name); err != nil {
			return pi, err
		}
		return pi, nil
	}

	return nil, fmt.Errorf("%q is neither a readable manifest file nor a Go install path (e.g. github.com/org/tool/cmd/tool)", arg)
}

// isGoInstallPath returns true for inputs that look like a Go module
// path. Matches bash csbx:585: contains at least two slashes OR starts
// with github.com/.
func isGoInstallPath(s string) bool {
	if strings.HasPrefix(s, "github.com/") {
		return true
	}
	return strings.Count(s, "/") >= 2
}

// applyDefaults fills in install_type="go" and version="latest" when
// the manifest leaves them blank. Mirrors bash csbx:597-598.
func (p *PdtmInput) applyDefaults() {
	if p.InstallType == "" {
		p.InstallType = "go"
	}
	if p.Version == "" {
		p.Version = "latest"
	}
}

// GoInstaller abstracts `go install` so tests can inject a fake. The
// production impl is ExecGoInstaller (uses os/exec with GOBIN env).
type GoInstaller interface {
	// CheckGo returns ErrPrereqMissing-wrapped if `go` is not in PATH.
	CheckGo(ctx context.Context) error
	// Install runs `GOBIN=<gobin> go install <goPath>@<version>` and
	// returns the combined output on failure for diagnostics.
	Install(ctx context.Context, gobin, goPath, version string) ([]byte, error)
}

// ExecGoInstaller is the production GoInstaller. Shells out to the
// user's `go` toolchain — NOT a bundled one — so the install honors
// the same GOSUMDB / GOPROXY / GOPRIVATE settings the user would
// expect from running `go install` themselves.
type ExecGoInstaller struct {
	// Timeout caps a single `go install` invocation. Zero means no cap.
	Timeout time.Duration
}

func (e *ExecGoInstaller) CheckGo(ctx context.Context) error {
	if _, err := exec.LookPath("go"); err != nil {
		return fmt.Errorf("%w: go toolchain required (install from https://go.dev/dl/)", ErrPrereqMissing)
	}
	return nil
}

func (e *ExecGoInstaller) Install(ctx context.Context, gobin, goPath, version string) ([]byte, error) {
	if e.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, e.Timeout)
		defer cancel()
	}
	target := goPath
	if version != "" && !strings.Contains(target, "@") {
		target = target + "@" + version
	}
	cmd := exec.CommandContext(ctx, "go", "install", target)
	cmd.Env = append(os.Environ(), "GOBIN="+gobin)
	return cmd.CombinedOutput()
}

// PdtmInstall runs the full pdtm pipeline: validate, check toolchain,
// invoke `go install`, record in installed.yaml. Returns the absolute
// install path (gobin/<name>) on success.
//
// `installer` is injected for testability; production passes
// &ExecGoInstaller{}. `paths` is the resolved $CSBX_HOME state layer.
func PdtmInstall(ctx context.Context, paths *Paths, installer GoInstaller, in *PdtmInput) (string, error) {
	if err := paths.EnsureDirs(); err != nil {
		return "", err
	}

	switch in.InstallType {
	case "go":
		// fall through
	case "binary":
		return "", errors.New("install_type=binary not yet implemented — use a csbx.yaml install script")
	default:
		return "", fmt.Errorf("unknown install_type: %q (only 'go' is supported)", in.InstallType)
	}

	if in.GoInstallPath == "" {
		return "", errors.New("install_type=go requires go_install_path")
	}

	if err := installer.CheckGo(ctx); err != nil {
		return "", err
	}

	if out, err := installer.Install(ctx, paths.Bin, in.GoInstallPath, in.Version); err != nil {
		return "", fmt.Errorf("go install %s@%s failed: %w (output: %s)",
			in.GoInstallPath, in.Version, err, strings.TrimSpace(string(out)))
	}

	target := paths.Bin + "/" + in.Name

	// Record in installed.yaml with source: pdtm so update can later
	// distinguish pdtm-installed tools from git-cloned plugins.
	inst, err := paths.LoadInstalled()
	if err != nil {
		return target, err
	}
	if inst.Plugins == nil {
		inst.Plugins = map[string]InstalledEntry{}
	}
	repo := in.Repo
	if repo == "" {
		// Mirror bash: take the part of the install path before /cmd/.
		repo = strings.SplitN(in.GoInstallPath, "/cmd", 2)[0]
	}
	inst.Plugins[in.Name] = InstalledEntry{
		Type:        "tool",
		Repo:        repo,
		InstalledAt: time.Now().UTC().Format(time.RFC3339),
		Path:        target,
		Source:      "pdtm",
	}
	if err := paths.SaveInstalled(inst); err != nil {
		return target, err
	}
	return target, nil
}
