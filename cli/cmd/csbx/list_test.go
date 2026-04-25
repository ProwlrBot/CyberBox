package csbx

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withCSBXHome sets CSBX_HOME to a fresh tempdir for the test's
// duration and returns it. Ensures the bash test_csbx.sh "use a temp
// home so we don't touch the real one" pattern carries over to Go tests.
func withCSBXHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("CSBX_HOME", home)
	t.Setenv("CSBX_REGISTRY_URL", "")
	return home
}

func TestListInstalledEmptyState(t *testing.T) {
	withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runList(false, stdout, stderr); err != nil {
		t.Fatalf("runList: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "Installed plugins:") {
		t.Errorf("missing header; got %q", out)
	}
	if !strings.Contains(out, "(none") {
		t.Errorf("empty state should hint with '(none'; got %q", out)
	}
}

func TestListInstalledSeededState(t *testing.T) {
	home := withCSBXHome(t)
	installed := `plugins:
  seclists:
    type: wordlist
    repo: https://github.com/danielmiessler/SecLists
    installed_at: "2026-04-25T01:00:00Z"
    path: ` + filepath.Join(home, "plugins", "wordlists", "seclists") + `
  subfinder:
    type: tool
    installed_at: "2026-04-25T01:01:00Z"
    path: ` + filepath.Join(home, "bin", "subfinder") + `
    source: pdtm
`
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "installed.yaml"), []byte(installed), 0o644); err != nil {
		t.Fatal(err)
	}

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runList(false, stdout, stderr); err != nil {
		t.Fatalf("runList: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "seclists") {
		t.Errorf("seclists missing; got %q", out)
	}
	if !strings.Contains(out, "subfinder") {
		t.Errorf("subfinder missing; got %q", out)
	}
	// Sorted: seclists comes before subfinder alphabetically.
	if strings.Index(out, "seclists") >= strings.Index(out, "subfinder") {
		t.Errorf("expected sorted order seclists < subfinder; got %q", out)
	}
}

func TestListAvailableNoRegistry(t *testing.T) {
	withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runList(true, stdout, stderr); err != nil {
		t.Fatalf("runList --available with no registry: %v", err)
	}
	if !strings.Contains(stderr.String(), "Registry") {
		t.Errorf("missing registry-empty hint on stderr; got %q", stderr.String())
	}
}

func TestListAvailableWithRegistry(t *testing.T) {
	home := withCSBXHome(t)
	registry := `version: 1
plugins:
  seclists:
    repo: https://github.com/danielmiessler/SecLists
    type: wordlist
    description: "Discovery and password lists"
    size: "1.2GB"
    tags: [recon, fuzzing]
  fuzzdb:
    repo: https://github.com/fuzzdb-project/fuzzdb
    type: wordlist
    description: "Attack patterns and payload lists"
    size: "60MB"
    tags: [fuzzing, payloads]
`
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "registry.yaml"), []byte(registry), 0o644); err != nil {
		t.Fatal(err)
	}

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runList(true, stdout, stderr); err != nil {
		t.Fatalf("runList --available: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "Available plugins:") {
		t.Errorf("missing header; got %q", out)
	}
	if !strings.Contains(out, "seclists") || !strings.Contains(out, "fuzzdb") {
		t.Errorf("missing plugin rows; got %q", out)
	}
	if stderr.Len() != 0 {
		t.Errorf("stderr should be empty when registry has entries; got %q", stderr.String())
	}
}
