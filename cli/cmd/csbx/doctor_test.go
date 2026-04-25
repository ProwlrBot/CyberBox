package csbx

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDoctorBootstrapsOnFreshHome(t *testing.T) {
	home := withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runDoctor(stdout, stderr); err != nil {
		t.Fatalf("runDoctor: %v", err)
	}
	out := stdout.String()
	for _, expect := range []string{
		"CyberSandbox Health Check",
		filepath.Join(home, "bin"),
		filepath.Join(home, "plugins"),
		"plugin(s) installed",
		"Plugin storage:",
	} {
		if !strings.Contains(out, expect) {
			t.Errorf("doctor output missing %q; got %q", expect, out)
		}
	}
	// Bash test_csbx.sh [3] asserts installed.yaml is created on first run.
	if _, err := os.Stat(filepath.Join(home, "installed.yaml")); err != nil {
		t.Errorf("installed.yaml not created: %v", err)
	}
}

func TestDoctorReportsBrokenSymlink(t *testing.T) {
	home := withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runDoctor(stdout, stderr); err != nil {
		t.Fatalf("first runDoctor: %v", err)
	}

	// Now create a symlink in $CSBX_HOME/bin pointing at a non-existent target.
	bin := filepath.Join(home, "bin")
	dangling := filepath.Join(bin, "dangling")
	if err := os.Symlink("/nonexistent/path/to/nowhere", dangling); err != nil {
		t.Skipf("cannot create symlink (filesystem limitation): %v", err)
	}

	stdout.Reset()
	if err := runDoctor(stdout, stderr); err != nil {
		t.Fatalf("second runDoctor: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "Broken symlink") {
		t.Errorf("expected 'Broken symlink' marker; got %q", out)
	}
	if strings.Contains(out, "[✓] No broken symlinks") {
		t.Error("doctor reported clean state despite dangling symlink")
	}
}

func TestDoctorCleanReportsNoBrokenSymlinks(t *testing.T) {
	withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runDoctor(stdout, stderr); err != nil {
		t.Fatalf("runDoctor: %v", err)
	}
	if !strings.Contains(stdout.String(), "No broken symlinks") {
		t.Errorf("clean state should report 'No broken symlinks'; got %q", stdout.String())
	}
}

func TestHumanSize(t *testing.T) {
	cases := []struct {
		bytes int64
		want  string
	}{
		{0, "0B"},
		{1023, "1023B"},
		{1024, "1.0K"},
		{1024 * 1024, "1.0M"},
		{int64(1024) * 1024 * 1024, "1.0G"},
		{int64(1.5 * 1024 * 1024), "1.5M"},
	}
	for _, c := range cases {
		got := humanSize(c.bytes)
		if got != c.want {
			t.Errorf("humanSize(%d) = %q; want %q", c.bytes, got, c.want)
		}
	}
}
