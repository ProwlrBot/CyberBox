package csbx

import (
	"context"
	"errors"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// fakeGoInstaller records calls and returns canned responses.
type fakeGoInstaller struct {
	checkErr   error
	installOut []byte
	installErr error
	calls      []string
}

func (f *fakeGoInstaller) CheckGo(ctx context.Context) error {
	f.calls = append(f.calls, "CheckGo")
	return f.checkErr
}

func (f *fakeGoInstaller) Install(ctx context.Context, gobin, goPath, version string) ([]byte, error) {
	f.calls = append(f.calls, "Install:"+gobin+":"+goPath+"@"+version)
	return f.installOut, f.installErr
}

func TestParsePdtmInputManifestFile(t *testing.T) {
	manifest := []byte(`name: subfinder
repo: projectdiscovery/subfinder
install_type: go
go_install_path: github.com/projectdiscovery/subfinder/v2/cmd/subfinder
version: latest
`)
	readFile := func(p string) ([]byte, error) {
		if p == "/tmp/manifest.yaml" {
			return manifest, nil
		}
		return nil, errors.New("not found")
	}

	in, err := ParsePdtmInput("/tmp/manifest.yaml", readFile, yaml.Unmarshal)
	if err != nil {
		t.Fatalf("ParsePdtmInput: %v", err)
	}
	if in.Name != "subfinder" {
		t.Errorf("Name = %q", in.Name)
	}
	if in.GoInstallPath != "github.com/projectdiscovery/subfinder/v2/cmd/subfinder" {
		t.Errorf("GoInstallPath = %q", in.GoInstallPath)
	}
	if in.Version != "latest" {
		t.Errorf("Version = %q", in.Version)
	}
	if !strings.HasPrefix(in.Source, "manifest:") {
		t.Errorf("Source = %q", in.Source)
	}
}

func TestParsePdtmInputManifestAppliesDefaults(t *testing.T) {
	manifest := []byte(`name: ffuf
go_install_path: github.com/ffuf/ffuf/v2
`)
	readFile := func(p string) ([]byte, error) { return manifest, nil }

	in, err := ParsePdtmInput("/manifest.yaml", readFile, yaml.Unmarshal)
	if err != nil {
		t.Fatalf("ParsePdtmInput: %v", err)
	}
	if in.InstallType != "go" {
		t.Errorf("InstallType default = %q; want go", in.InstallType)
	}
	if in.Version != "latest" {
		t.Errorf("Version default = %q; want latest", in.Version)
	}
}

func TestParsePdtmInputBareGoPath(t *testing.T) {
	readFile := func(p string) ([]byte, error) { return nil, errors.New("not a file") }

	in, err := ParsePdtmInput("github.com/projectdiscovery/subfinder/v2/cmd/subfinder",
		readFile, yaml.Unmarshal)
	if err != nil {
		t.Fatalf("ParsePdtmInput bare go-path: %v", err)
	}
	if in.Name != "subfinder" {
		t.Errorf("Name = %q; want subfinder (basename)", in.Name)
	}
	if in.Version != "latest" {
		t.Errorf("Version = %q; want latest", in.Version)
	}
}

func TestParsePdtmInputBareGoPathWithVersion(t *testing.T) {
	readFile := func(p string) ([]byte, error) { return nil, errors.New("nope") }

	in, err := ParsePdtmInput("github.com/projectdiscovery/subfinder/v2/cmd/subfinder@v2.6.4",
		readFile, yaml.Unmarshal)
	if err != nil {
		t.Fatalf("ParsePdtmInput: %v", err)
	}
	if in.Version != "v2.6.4" {
		t.Errorf("Version = %q; want v2.6.4", in.Version)
	}
	if strings.Contains(in.GoInstallPath, "@") {
		t.Errorf("GoInstallPath should not include @; got %q", in.GoInstallPath)
	}
	if in.Name != "subfinder" {
		t.Errorf("Name = %q", in.Name)
	}
}

func TestParsePdtmInputRejectsNonsense(t *testing.T) {
	readFile := func(p string) ([]byte, error) { return nil, errors.New("nope") }
	_, err := ParsePdtmInput("just-a-word", readFile, yaml.Unmarshal)
	if err == nil {
		t.Fatal("expected error for non-manifest non-go-path input")
	}
}

func TestParsePdtmInputValidatesName(t *testing.T) {
	manifest := []byte(`name: ../etc/passwd
go_install_path: github.com/x/y
`)
	readFile := func(p string) ([]byte, error) { return manifest, nil }
	_, err := ParsePdtmInput("/tmp/m.yaml", readFile, yaml.Unmarshal)
	if err == nil {
		t.Fatal("expected ValidateName failure for path-traversal name")
	}
}

func TestPdtmInstallHappyPath(t *testing.T) {
	p := tempPaths(t)
	if err := p.EnsureDirs(); err != nil {
		t.Fatal(err)
	}
	gi := &fakeGoInstaller{installOut: []byte("installed.")}
	in := &PdtmInput{
		Name:          "subfinder",
		Repo:          "projectdiscovery/subfinder",
		InstallType:   "go",
		GoInstallPath: "github.com/projectdiscovery/subfinder/v2/cmd/subfinder",
		Version:       "latest",
	}
	target, err := PdtmInstall(context.Background(), p, gi, in)
	if err != nil {
		t.Fatalf("PdtmInstall: %v", err)
	}
	if !strings.HasSuffix(target, "/bin/subfinder") {
		t.Errorf("target = %q; want path under bin/", target)
	}

	// installed.yaml should have the entry with source: pdtm.
	inst, err := p.LoadInstalled()
	if err != nil {
		t.Fatal(err)
	}
	entry, ok := inst.Plugins["subfinder"]
	if !ok {
		t.Fatalf("subfinder not recorded in installed.yaml; got %v", inst.Plugins)
	}
	if entry.Source != "pdtm" {
		t.Errorf("entry.Source = %q; want pdtm", entry.Source)
	}
	if entry.Type != "tool" {
		t.Errorf("entry.Type = %q; want tool", entry.Type)
	}
	if entry.Path != target {
		t.Errorf("entry.Path = %q; want %q", entry.Path, target)
	}
	if entry.Repo != "projectdiscovery/subfinder" {
		t.Errorf("entry.Repo = %q", entry.Repo)
	}
}

func TestPdtmInstallDerivesRepoFromPath(t *testing.T) {
	p := tempPaths(t)
	if err := p.EnsureDirs(); err != nil {
		t.Fatal(err)
	}
	gi := &fakeGoInstaller{}
	in := &PdtmInput{
		Name:          "subfinder",
		InstallType:   "go",
		GoInstallPath: "github.com/projectdiscovery/subfinder/v2/cmd/subfinder",
		Version:       "latest",
	}
	if _, err := PdtmInstall(context.Background(), p, gi, in); err != nil {
		t.Fatalf("PdtmInstall: %v", err)
	}
	inst, _ := p.LoadInstalled()
	if got := inst.Plugins["subfinder"].Repo; got != "github.com/projectdiscovery/subfinder/v2" {
		t.Errorf("derived Repo = %q; want path before /cmd", got)
	}
}

func TestPdtmInstallGoMissingExitsPrereq(t *testing.T) {
	p := tempPaths(t)
	gi := &fakeGoInstaller{checkErr: ErrPrereqMissing}
	_, err := PdtmInstall(context.Background(), p, gi, &PdtmInput{
		Name:          "x", InstallType: "go",
		GoInstallPath: "github.com/x/y",
	})
	if !errors.Is(err, ErrPrereqMissing) {
		t.Errorf("err should wrap ErrPrereqMissing; got %v", err)
	}
}

func TestPdtmInstallBinaryTypeNotImplemented(t *testing.T) {
	p := tempPaths(t)
	_, err := PdtmInstall(context.Background(), p, &fakeGoInstaller{}, &PdtmInput{
		Name: "x", InstallType: "binary",
	})
	if err == nil || !strings.Contains(err.Error(), "binary") {
		t.Errorf("expected binary-not-implemented error; got %v", err)
	}
}

func TestPdtmInstallUnknownTypeFails(t *testing.T) {
	p := tempPaths(t)
	_, err := PdtmInstall(context.Background(), p, &fakeGoInstaller{}, &PdtmInput{
		Name: "x", InstallType: "snap",
	})
	if err == nil || !strings.Contains(err.Error(), "unknown install_type") {
		t.Errorf("expected unknown-type error; got %v", err)
	}
}

func TestPdtmInstallEmptyGoPathFails(t *testing.T) {
	p := tempPaths(t)
	_, err := PdtmInstall(context.Background(), p, &fakeGoInstaller{}, &PdtmInput{
		Name: "x", InstallType: "go", GoInstallPath: "",
	})
	if err == nil || !strings.Contains(err.Error(), "go_install_path") {
		t.Errorf("expected go_install_path error; got %v", err)
	}
}

func TestPdtmInstallSurfacesInstallFailure(t *testing.T) {
	p := tempPaths(t)
	if err := p.EnsureDirs(); err != nil {
		t.Fatal(err)
	}
	gi := &fakeGoInstaller{
		installErr: errors.New("module not found"),
		installOut: []byte("go: github.com/x/y@latest: not found"),
	}
	_, err := PdtmInstall(context.Background(), p, gi, &PdtmInput{
		Name: "y", InstallType: "go",
		GoInstallPath: "github.com/x/y", Version: "latest",
	})
	if err == nil || !strings.Contains(err.Error(), "go install") {
		t.Errorf("expected install failure; got %v", err)
	}
	// And NOT recorded in installed.yaml on failure.
	inst, _ := p.LoadInstalled()
	if _, has := inst.Plugins["y"]; has {
		t.Error("failed install should not appear in installed.yaml")
	}
}

func TestIsGoInstallPath(t *testing.T) {
	yes := []string{
		"github.com/x/y",
		"github.com/projectdiscovery/subfinder/v2/cmd/subfinder",
		"gitlab.com/some/org/tool",
		"example.com/a/b/c",
	}
	no := []string{
		"single-word",
		"a/b",
		"",
	}
	for _, s := range yes {
		if !isGoInstallPath(s) {
			t.Errorf("isGoInstallPath(%q) = false; want true", s)
		}
	}
	for _, s := range no {
		if isGoInstallPath(s) {
			t.Errorf("isGoInstallPath(%q) = true; want false", s)
		}
	}
}
