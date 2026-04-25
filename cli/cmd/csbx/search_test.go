package csbx

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeRegistry(t *testing.T, home string) {
	t.Helper()
	registry := `version: 1
plugins:
  seclists:
    repo: https://github.com/danielmiessler/SecLists
    type: wordlist
    description: "Discovery, fuzzing, and password lists"
    size: "1.2GB"
    tags: [recon, fuzzing, passwords]
  payloadsallthethings:
    repo: https://github.com/swisskyrepo/PayloadsAllTheThings
    type: wordlist
    description: "Payload lists for web app security"
    size: "200MB"
    tags: [payloads, injection, xss, sqli]
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
}

func TestSearchEmptyQueryListsAll(t *testing.T) {
	home := withCSBXHome(t)
	writeRegistry(t, home)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runSearch("", stdout, stderr); err != nil {
		t.Fatalf("runSearch: %v", err)
	}
	out := stdout.String()
	for _, name := range []string{"seclists", "fuzzdb", "payloadsallthethings"} {
		if !strings.Contains(out, name) {
			t.Errorf("missing %s; got %q", name, out)
		}
	}
}

func TestSearchByTagSubstring(t *testing.T) {
	home := withCSBXHome(t)
	writeRegistry(t, home)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runSearch("xss", stdout, stderr); err != nil {
		t.Fatalf("runSearch xss: %v", err)
	}
	out := stdout.String()
	// xss is a tag of payloadsallthethings only.
	if !strings.Contains(out, "payloadsallthethings") {
		t.Errorf("expected payloadsallthethings; got %q", out)
	}
	if strings.Contains(out, "seclists") {
		t.Errorf("xss should not match seclists; got %q", out)
	}
}

func TestSearchByDescriptionSubstring(t *testing.T) {
	home := withCSBXHome(t)
	writeRegistry(t, home)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runSearch("password", stdout, stderr); err != nil {
		t.Fatalf("runSearch password: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "seclists") {
		t.Errorf("seclists has 'password' in description; got %q", out)
	}
}

func TestSearchCaseInsensitive(t *testing.T) {
	home := withCSBXHome(t)
	writeRegistry(t, home)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runSearch("FUZZING", stdout, stderr); err != nil {
		t.Fatalf("runSearch FUZZING: %v", err)
	}
	if !strings.Contains(stdout.String(), "seclists") {
		t.Errorf("FUZZING should match seclists (tag fuzzing); got %q", stdout.String())
	}
}

func TestSearchNoMatchPrintsHint(t *testing.T) {
	home := withCSBXHome(t)
	writeRegistry(t, home)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runSearch("nothing-matches-this", stdout, stderr); err != nil {
		t.Fatalf("runSearch: %v", err)
	}
	if !strings.Contains(stderr.String(), "No plugins matched") {
		t.Errorf("expected no-match hint on stderr; got %q", stderr.String())
	}
}

func TestSearchNoRegistryHints(t *testing.T) {
	withCSBXHome(t)
	// Don't write registry.yaml.
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runSearch("anything", stdout, stderr); err != nil {
		t.Fatalf("runSearch with no registry: %v", err)
	}
	// Bash test_csbx.sh [5] tolerates 'sync|registry|no|fuzzing' — match 'sync' or 'Registry'.
	if !strings.Contains(stderr.String(), "Registry") &&
		!strings.Contains(stderr.String(), "sync") {
		t.Errorf("expected sync/Registry hint on stderr; got %q", stderr.String())
	}
}
