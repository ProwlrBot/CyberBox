package csbx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func tempPaths(t *testing.T) *Paths {
	t.Helper()
	home := t.TempDir()
	t.Setenv("CSBX_HOME", home)
	t.Setenv("CSBX_REGISTRY_URL", "")
	p, err := NewPaths()
	if err != nil {
		t.Fatalf("NewPaths: %v", err)
	}
	if p.Home != home {
		t.Fatalf("Home = %q; want %q", p.Home, home)
	}
	return p
}

func TestNewPathsHonorsEnv(t *testing.T) {
	p := tempPaths(t)
	if p.Bin != filepath.Join(p.Home, "bin") {
		t.Errorf("Bin = %q; want under Home", p.Bin)
	}
	if p.RegistryURL != DefaultRegistryURL {
		t.Errorf("RegistryURL = %q; want default", p.RegistryURL)
	}
}

func TestNewPathsHonorsRegistryURLOverride(t *testing.T) {
	t.Setenv("CSBX_HOME", t.TempDir())
	t.Setenv("CSBX_REGISTRY_URL", "https://example.com/reg.yaml")
	p, err := NewPaths()
	if err != nil {
		t.Fatalf("NewPaths: %v", err)
	}
	if p.RegistryURL != "https://example.com/reg.yaml" {
		t.Errorf("RegistryURL = %q; want override", p.RegistryURL)
	}
}

func TestEnsureDirsCreatesTreeAndBootstrapsInstalled(t *testing.T) {
	p := tempPaths(t)
	if err := p.EnsureDirs(); err != nil {
		t.Fatalf("EnsureDirs: %v", err)
	}
	for _, sub := range PluginTypeDirs {
		dir := filepath.Join(p.Plugins, sub)
		if _, err := os.Stat(dir); err != nil {
			t.Errorf("%s missing: %v", dir, err)
		}
	}
	if _, err := os.Stat(p.Bin); err != nil {
		t.Errorf("bin dir missing: %v", err)
	}
	bytes, err := os.ReadFile(p.Installed)
	if err != nil {
		t.Fatalf("read installed.yaml: %v", err)
	}
	if !strings.Contains(string(bytes), "plugins:") {
		t.Errorf("installed.yaml content = %q; want plugins: bootstrap", string(bytes))
	}
}

func TestEnsureDirsIdempotent(t *testing.T) {
	p := tempPaths(t)
	if err := p.EnsureDirs(); err != nil {
		t.Fatalf("first EnsureDirs: %v", err)
	}
	// Mutate installed.yaml so we can assert we didn't clobber it on
	// the second pass.
	custom := []byte("plugins:\n  acme:\n    type: tool\n    path: /x\n    installed_at: '2026-01-01'\n")
	if err := os.WriteFile(p.Installed, custom, 0o644); err != nil {
		t.Fatalf("write custom installed.yaml: %v", err)
	}
	if err := p.EnsureDirs(); err != nil {
		t.Fatalf("second EnsureDirs: %v", err)
	}
	bytes, err := os.ReadFile(p.Installed)
	if err != nil {
		t.Fatalf("re-read installed.yaml: %v", err)
	}
	if !strings.Contains(string(bytes), "acme") {
		t.Error("EnsureDirs clobbered existing installed.yaml")
	}
}

func TestLoadRegistryMissingReturnsEmptyNoError(t *testing.T) {
	p := tempPaths(t)
	reg, err := p.LoadRegistry()
	if err != nil {
		t.Fatalf("LoadRegistry on missing file: %v", err)
	}
	if reg == nil {
		t.Fatal("LoadRegistry returned nil; want zero value")
	}
	if len(reg.Plugins) != 0 {
		t.Errorf("Plugins = %v; want empty", reg.Plugins)
	}
}

func TestLoadRegistryParsesPlugins(t *testing.T) {
	p := tempPaths(t)
	if err := p.EnsureDirs(); err != nil {
		t.Fatalf("EnsureDirs: %v", err)
	}
	yaml := `version: 1
plugins:
  seclists:
    repo: https://github.com/danielmiessler/SecLists
    type: wordlist
    description: "Discovery and password lists"
    size: "1.2GB"
    tags: [recon, fuzzing]
  nuclei-templates:
    repo: https://github.com/projectdiscovery/nuclei-templates
    type: nuclei-templates
    size: "180MB"
`
	if err := os.WriteFile(p.Registry, []byte(yaml), 0o644); err != nil {
		t.Fatalf("write registry.yaml: %v", err)
	}
	reg, err := p.LoadRegistry()
	if err != nil {
		t.Fatalf("LoadRegistry: %v", err)
	}
	if reg.Version != 1 {
		t.Errorf("Version = %d; want 1", reg.Version)
	}
	if len(reg.Plugins) != 2 {
		t.Fatalf("Plugins count = %d; want 2", len(reg.Plugins))
	}
	sec := reg.Plugins["seclists"]
	if sec.Repo != "https://github.com/danielmiessler/SecLists" {
		t.Errorf("seclists.Repo = %q", sec.Repo)
	}
	if got := sec.Tags; len(got) != 2 || got[0] != "recon" || got[1] != "fuzzing" {
		t.Errorf("seclists.Tags = %v", got)
	}
}

func TestLoadInstalledRoundtripsViaSave(t *testing.T) {
	p := tempPaths(t)
	if err := p.EnsureDirs(); err != nil {
		t.Fatalf("EnsureDirs: %v", err)
	}
	inst := &Installed{
		Plugins: map[string]InstalledEntry{
			"seclists": {
				Type:        "wordlist",
				Repo:        "https://github.com/danielmiessler/SecLists",
				InstalledAt: "2026-04-25T12:00:00Z",
				Path:        filepath.Join(p.Plugins, "wordlists", "seclists"),
			},
			"subfinder": {
				Type:        "tool",
				InstalledAt: "2026-04-25T12:01:00Z",
				Path:        filepath.Join(p.Bin, "subfinder"),
				Source:      "pdtm",
			},
		},
	}
	if err := p.SaveInstalled(inst); err != nil {
		t.Fatalf("SaveInstalled: %v", err)
	}
	round, err := p.LoadInstalled()
	if err != nil {
		t.Fatalf("LoadInstalled: %v", err)
	}
	if len(round.Plugins) != 2 {
		t.Fatalf("Plugins count = %d; want 2", len(round.Plugins))
	}
	if round.Plugins["subfinder"].Source != "pdtm" {
		t.Errorf("subfinder.Source = %q; want pdtm", round.Plugins["subfinder"].Source)
	}
	if round.Plugins["seclists"].Source != "" {
		t.Errorf("seclists.Source = %q; want empty (omitempty)", round.Plugins["seclists"].Source)
	}
}

func TestLoadManifestMissingReturnsNilNoError(t *testing.T) {
	m, err := LoadManifest(filepath.Join(t.TempDir(), "csbx.yaml"))
	if err != nil {
		t.Fatalf("LoadManifest on missing file: %v", err)
	}
	if m != nil {
		t.Errorf("got %+v; want nil for missing manifest", m)
	}
}

func TestLoadManifestParsesHookScripts(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "csbx.yaml")
	yaml := `type: tool
binaries:
  - bin/example
install: |
  echo "installing"
  make
post_install: |
  echo "done"
uninstall: |
  rm -rf build/
`
	if err := os.WriteFile(path, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := LoadManifest(path)
	if err != nil {
		t.Fatalf("LoadManifest: %v", err)
	}
	if m.Type != "tool" {
		t.Errorf("Type = %q; want tool", m.Type)
	}
	if len(m.Binaries) != 1 || m.Binaries[0] != "bin/example" {
		t.Errorf("Binaries = %v", m.Binaries)
	}
	if !strings.Contains(m.Install, "make") {
		t.Errorf("Install missing make: %q", m.Install)
	}
	if !strings.Contains(m.Uninstall, "rm -rf build") {
		t.Errorf("Uninstall missing rm: %q", m.Uninstall)
	}
}

func TestValidateNameAccepts(t *testing.T) {
	good := []string{"seclists", "nuclei-templates", "powerlevel10k", "gf-patterns", "abc.def_ghi"}
	for _, n := range good {
		if err := ValidateName(n); err != nil {
			t.Errorf("ValidateName(%q) = %v; want nil", n, err)
		}
	}
}

func TestValidateNameRejects(t *testing.T) {
	bad := []string{"", "../etc/passwd", "name with space", "name|pipe", "name;rm", "name/slash", "..", "name$"}
	for _, n := range bad {
		if err := ValidateName(n); err == nil {
			t.Errorf("ValidateName(%q) = nil; want error", n)
		}
	}
}

func TestSaveInstalledIsAtomic(t *testing.T) {
	p := tempPaths(t)
	if err := p.EnsureDirs(); err != nil {
		t.Fatalf("EnsureDirs: %v", err)
	}
	// Save once to establish a known state.
	first := &Installed{Plugins: map[string]InstalledEntry{
		"a": {Type: "tool", Path: "/x", InstalledAt: "t1"},
	}}
	if err := p.SaveInstalled(first); err != nil {
		t.Fatalf("first save: %v", err)
	}
	// Save again with different content.
	second := &Installed{Plugins: map[string]InstalledEntry{
		"b": {Type: "wordlist", Path: "/y", InstalledAt: "t2"},
	}}
	if err := p.SaveInstalled(second); err != nil {
		t.Fatalf("second save: %v", err)
	}
	// No leftover temp files in $CSBX_HOME root.
	entries, err := os.ReadDir(p.Home)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "installed-") && e.Name() != "installed.yaml" {
			t.Errorf("leftover temp file: %s", e.Name())
		}
	}
	// Final state matches the second write.
	round, err := p.LoadInstalled()
	if err != nil {
		t.Fatal(err)
	}
	if _, has := round.Plugins["a"]; has {
		t.Error("first-save 'a' still present; second save did not replace")
	}
	if _, has := round.Plugins["b"]; !has {
		t.Error("second-save 'b' missing")
	}
}
