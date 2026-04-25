package csbx

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	csbxstate "github.com/ProwlrBot/CyberBox/cli/internal/csbx"
)

// fakePdtmInstaller is local-package equivalent of internal/csbx's
// fakeGoInstaller, kept here so the cobra wrapper test is self-contained.
type fakePdtmInstaller struct {
	checkErr   error
	installErr error
	installOut []byte
}

func (f *fakePdtmInstaller) CheckGo(ctx context.Context) error { return f.checkErr }
func (f *fakePdtmInstaller) Install(ctx context.Context, gobin, goPath, version string) ([]byte, error) {
	return f.installOut, f.installErr
}

func TestRunPdtmHappyPathBareGoPath(t *testing.T) {
	withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runPdtm(context.Background(), &fakePdtmInstaller{},
		"github.com/projectdiscovery/subfinder/v2/cmd/subfinder",
		stdout, stderr); err != nil {
		t.Fatalf("runPdtm: %v", err)
	}
	for _, expect := range []string{
		"[+] Installing subfinder",
		"[✓] subfinder installed",
	} {
		if !strings.Contains(stdout.String(), expect) {
			t.Errorf("stdout missing %q; got %q", expect, stdout.String())
		}
	}
}

func TestRunPdtmManifestFile(t *testing.T) {
	home := withCSBXHome(t)
	manifestPath := filepath.Join(home, "subfinder.yaml")
	manifest := []byte(`name: subfinder
repo: projectdiscovery/subfinder
install_type: go
go_install_path: github.com/projectdiscovery/subfinder/v2/cmd/subfinder
version: latest
`)
	if err := os.WriteFile(manifestPath, manifest, 0o644); err != nil {
		t.Fatal(err)
	}

	stdout, _ := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runPdtm(context.Background(), &fakePdtmInstaller{}, manifestPath, stdout, &bytes.Buffer{}); err != nil {
		t.Fatalf("runPdtm: %v", err)
	}
	if !strings.Contains(stdout.String(), "subfinder installed") {
		t.Errorf("stdout missing success line; got %q", stdout.String())
	}
}

func TestRunPdtmGoMissingExitsWithPrereqError(t *testing.T) {
	withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runPdtm(context.Background(),
		&fakePdtmInstaller{checkErr: csbxstate.ErrPrereqMissing},
		"github.com/x/y/cmd/z", stdout, stderr)
	if err == nil {
		t.Fatal("expected error when go missing")
	}
	if !errors.Is(err, csbxstate.ErrPrereqMissing) {
		t.Errorf("err should wrap ErrPrereqMissing; got %v", err)
	}
	if !strings.Contains(stderr.String(), "prerequisite tool missing") {
		t.Errorf("stderr should mention prereq; got %q", stderr.String())
	}
}

func TestRunPdtmInstallFailureSurfacesOutput(t *testing.T) {
	withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runPdtm(context.Background(),
		&fakePdtmInstaller{
			installErr: errors.New("exit 1"),
			installOut: []byte("go: module not found"),
		},
		"github.com/x/y/cmd/z", stdout, stderr)
	if err == nil {
		t.Fatal("expected install error")
	}
	if !strings.Contains(stderr.String(), "go install") {
		t.Errorf("stderr should mention go install; got %q", stderr.String())
	}
}

func TestRunPdtmRejectsBadInput(t *testing.T) {
	withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runPdtm(context.Background(), &fakePdtmInstaller{}, "some-bad-arg", stdout, stderr)
	if err == nil {
		t.Fatal("expected ParsePdtmInput error")
	}
	if !strings.Contains(stderr.String(), "[x]") {
		t.Errorf("stderr should mark error; got %q", stderr.String())
	}
}
