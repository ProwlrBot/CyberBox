// Package csbx is the typed state layer for cybersandbox plugin
// management. The bash csbx persists two YAML files under $CSBX_HOME —
// registry.yaml (cached upstream catalog) and installed.yaml (local
// install record). This package gives both files typed Go structs so
// the cmd/csbx subcommands operate on values, not interface{} blobs.
//
// Spec 018 phase 3-2a, layered on the audit at
// cli/cmd/csbx/PORT_AUDIT.md.
package csbx

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// Registry mirrors the upstream csbx-registry.yaml format. Spec 011's
// intake CI is the source of truth for what fields the registry can
// carry; we add new fields as Spec 011 does.
type Registry struct {
	Version int                      `yaml:"version"`
	Plugins map[string]RegistryEntry `yaml:"plugins"`
}

// RegistryEntry describes one plugin in the catalog. Spec 012 will add
// SignatureURL/Identity/OIDCIssuer for cosign-gated installs; the
// fields are pre-declared so the struct doesn't shift shape later.
type RegistryEntry struct {
	Repo        string   `yaml:"repo"`
	Type        string   `yaml:"type"`
	Description string   `yaml:"description,omitempty"`
	Size        string   `yaml:"size,omitempty"`
	Tags        []string `yaml:"tags,omitempty"`

	// Reserved for spec 012. Empty until then.
	SignatureURL string `yaml:"signature_url,omitempty"`
	Identity     string `yaml:"identity,omitempty"`
	OIDCIssuer   string `yaml:"oidc_issuer,omitempty"`
}

// Installed mirrors $CSBX_HOME/installed.yaml.
type Installed struct {
	Plugins map[string]InstalledEntry `yaml:"plugins"`
}

// InstalledEntry records what `csbx install` wrote. Source distinguishes
// pdtm-installed (`go install`) from git-cloned (default empty); the
// bash csbx records `source: pdtm` only for pdtm and leaves it omitted
// otherwise.
type InstalledEntry struct {
	Type        string `yaml:"type"`
	Repo        string `yaml:"repo,omitempty"`
	InstalledAt string `yaml:"installed_at"`
	Path        string `yaml:"path"`
	Source      string `yaml:"source,omitempty"`
}

// Manifest is the per-plugin csbx.yaml shape. install/post_install/
// uninstall are multi-line shell scripts; the Go port executes them via
// `bash -c` (or `sh -c` fallback) preserving the bash semantics.
type Manifest struct {
	Type        string   `yaml:"type"`
	Binaries    []string `yaml:"binaries,omitempty"`
	Install     string   `yaml:"install,omitempty"`
	PostInstall string   `yaml:"post_install,omitempty"`
	Uninstall   string   `yaml:"uninstall,omitempty"`
}

// Paths bundles every filesystem location csbx cares about. Construct
// via NewPaths so the env-var defaults match the bash csbx exactly.
type Paths struct {
	Home          string // $CSBX_HOME, default $HOME/.csbx
	Bin           string // $CSBX_HOME/bin
	Plugins       string // $CSBX_HOME/plugins
	Registry      string // $CSBX_HOME/registry.yaml
	Installed     string // $CSBX_HOME/installed.yaml
	RegistryURL   string // $CSBX_REGISTRY_URL or upstream default
}

// DefaultRegistryURL is the upstream catalog. Override via $CSBX_REGISTRY_URL.
const DefaultRegistryURL = "https://raw.githubusercontent.com/ProwlrBot/csbx-registry/main/registry.yaml"

// PluginTypeDirs are the subdirs under $CSBX_HOME/plugins that
// EnsureDirs creates. Mirrors the bash ensure_dirs at csbx:28-36.
var PluginTypeDirs = []string{"tools", "wordlists", "nuclei-templates", "themes", "configs"}

// NewPaths resolves $CSBX_HOME (defaulting to $HOME/.csbx) and derives
// every other path. Honors $CSBX_REGISTRY_URL for the registry source.
func NewPaths() (*Paths, error) {
	home := os.Getenv("CSBX_HOME")
	if home == "" {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("resolve home directory: %w", err)
		}
		home = filepath.Join(userHome, ".csbx")
	}
	registryURL := os.Getenv("CSBX_REGISTRY_URL")
	if registryURL == "" {
		registryURL = DefaultRegistryURL
	}
	return &Paths{
		Home:        home,
		Bin:         filepath.Join(home, "bin"),
		Plugins:     filepath.Join(home, "plugins"),
		Registry:    filepath.Join(home, "registry.yaml"),
		Installed:   filepath.Join(home, "installed.yaml"),
		RegistryURL: registryURL,
	}, nil
}

// EnsureDirs creates $CSBX_HOME/{bin,plugins/{tools,wordlists,...}} and
// bootstraps installed.yaml with `plugins: {}` if missing. Idempotent.
// Mirrors bash csbx:28-36 + 30 (installed.yaml init).
func (p *Paths) EnsureDirs() error {
	if err := os.MkdirAll(p.Bin, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", p.Bin, err)
	}
	for _, sub := range PluginTypeDirs {
		dir := filepath.Join(p.Plugins, sub)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", dir, err)
		}
	}
	if _, err := os.Stat(p.Installed); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(p.Installed, []byte("plugins: {}\n"), 0o644); err != nil {
			return fmt.Errorf("init %s: %w", p.Installed, err)
		}
	}
	return nil
}

// LoadRegistry reads p.Registry. Returns an empty Registry (no error) if
// the file is missing — matches the bash lazy-sync semantics where
// callers can decide whether to trigger a sync.
func (p *Paths) LoadRegistry() (*Registry, error) {
	return loadYAMLFile[Registry](p.Registry)
}

// LoadInstalled reads p.Installed. EnsureDirs guarantees the file
// exists, so a missing file at this layer is a programmer error rather
// than a soft-fail case.
func (p *Paths) LoadInstalled() (*Installed, error) {
	return loadYAMLFile[Installed](p.Installed)
}

// LoadManifest reads a plugin's csbx.yaml. Returns nil if the manifest
// doesn't exist (some plugins ship without one — wordlist repos for
// instance).
func LoadManifest(path string) (*Manifest, error) {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return loadYAMLFile[Manifest](path)
}

// loadYAMLFile is the shared YAML reader. Generic over the target type
// so each Load function gets typed output without copy-paste.
func loadYAMLFile[T any](path string) (*T, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			var zero T
			return &zero, nil
		}
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	bytes, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var v T
	if err := yaml.Unmarshal(bytes, &v); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return &v, nil
}

// SaveInstalled writes p.Installed atomically. Writes to a temp file in
// the same directory, then renames — so a partial write can never
// corrupt the canonical file.
func (p *Paths) SaveInstalled(inst *Installed) error {
	bytes, err := yaml.Marshal(inst)
	if err != nil {
		return fmt.Errorf("encode installed.yaml: %w", err)
	}
	tmp, err := os.CreateTemp(p.Home, "installed-*.yaml")
	if err != nil {
		return fmt.Errorf("temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op if rename succeeded
	if _, err := tmp.Write(bytes); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Rename(tmpName, p.Installed); err != nil {
		return fmt.Errorf("rename to %s: %w", p.Installed, err)
	}
	return nil
}

// validNameRE enforces the same constraint as bash csbx:89-96
// validate_name. Alphanumeric plus dot/dash/underscore; the `..`
// path-traversal test is implicit (the regex denies anything outside
// the alphabet).
var validNameRE = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

// ValidateName mirrors bash csbx:89-96 plus a hardening fix the audit
// flagged: bash only rejects "../" but lets bare "." and ".." through.
// We reject those explicitly because they're dangerous as path
// components even without a trailing slash. Returns nil if `name` is
// safe to use as a path component, an error otherwise.
//
// The audit also flagged that `csbx.yaml.type` should be validated by
// the same function before being used to construct a target dir
// (otherwise a malicious registry entry could path-traverse). Helpers
// that build paths from manifest fields should call this.
func ValidateName(name string) error {
	if name == "" {
		return errors.New("plugin name cannot be empty")
	}
	if name == "." || name == ".." {
		return fmt.Errorf("invalid plugin name %q: reserved path component", name)
	}
	if strings.Contains(name, "../") {
		return fmt.Errorf("invalid plugin name %q: contains path traversal", name)
	}
	if !validNameRE.MatchString(name) {
		return fmt.Errorf("invalid plugin name %q: only alphanumeric, dot, dash, underscore allowed", name)
	}
	return nil
}
