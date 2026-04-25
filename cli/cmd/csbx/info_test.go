package csbx

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInfoNonExistentExitsZeroWithMessage(t *testing.T) {
	home := withCSBXHome(t)
	writeRegistry(t, home) // registry has seclists, fuzzdb, payloadsallthethings only

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	// Bash test_csbx.sh [6] asserts info on a nonexistent plugin
	// reports 'not in registry' and does NOT crash. Go port matches.
	if err := runInfo("nonexistent-plugin", stdout, stderr); err != nil {
		t.Fatalf("runInfo nonexistent: %v", err)
	}
	if !strings.Contains(stdout.String(), "not in registry") {
		t.Errorf("expected 'not in registry'; got %q", stdout.String())
	}
}

func TestInfoExistingPluginNotInstalled(t *testing.T) {
	home := withCSBXHome(t)
	writeRegistry(t, home)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runInfo("seclists", stdout, stderr); err != nil {
		t.Fatalf("runInfo seclists: %v", err)
	}
	out := stdout.String()
	for _, expect := range []string{
		"seclists",
		"Type:",
		"wordlist",
		"Repo:",
		"github.com/danielmiessler/SecLists",
		"Tags:",
		"recon, fuzzing, passwords",
		"Not installed",
	} {
		if !strings.Contains(out, expect) {
			t.Errorf("info output missing %q; got %q", expect, out)
		}
	}
	_ = stderr
}

func TestInfoExistingPluginInstalled(t *testing.T) {
	home := withCSBXHome(t)
	writeRegistry(t, home)
	installed := `plugins:
  seclists:
    type: wordlist
    repo: https://github.com/danielmiessler/SecLists
    installed_at: "2026-04-25T01:23:45Z"
    path: ` + filepath.Join(home, "plugins", "wordlists", "seclists") + `
`
	if err := os.WriteFile(filepath.Join(home, "installed.yaml"), []byte(installed), 0o644); err != nil {
		t.Fatal(err)
	}

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runInfo("seclists", stdout, stderr); err != nil {
		t.Fatalf("runInfo seclists: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "Installed:") {
		t.Errorf("expected 'Installed:' line; got %q", out)
	}
	if !strings.Contains(out, "2026-04-25T01:23:45Z") {
		t.Errorf("expected timestamp; got %q", out)
	}
	if strings.Contains(out, "Not installed") {
		t.Errorf("should not print 'Not installed' for installed plugin; got %q", out)
	}
	_ = stderr
}

func TestInfoRejectsInvalidName(t *testing.T) {
	withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runInfo("../etc/passwd", stdout, stderr); err == nil {
		t.Fatal("expected error for path-traversal name")
	}
	if !strings.Contains(stderr.String(), "invalid plugin name") {
		t.Errorf("expected validation error; got %q", stderr.String())
	}
}
