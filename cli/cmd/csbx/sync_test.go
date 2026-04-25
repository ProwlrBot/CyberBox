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

// fakeSyncFetcher is the local equivalent of internal/csbx's fakeFetcher,
// kept here so the cobra wrapper has a self-contained test.
type fakeSyncFetcher struct {
	body []byte
	err  error
}

func (f *fakeSyncFetcher) Get(ctx context.Context, url string) ([]byte, error) {
	return f.body, f.err
}

func TestRunSyncRemoteSuccess(t *testing.T) {
	withCSBXHome(t)
	body := []byte("version: 1\nplugins: {}\n")

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runSync(context.Background(), &fakeSyncFetcher{body: body}, stdout, stderr); err != nil {
		t.Fatalf("runSync: %v", err)
	}
	if !strings.Contains(stdout.String(), "[✓] Registry synced from") {
		t.Errorf("expected success marker; got %q", stdout.String())
	}
	if stderr.Len() != 0 {
		t.Errorf("stderr should be empty on remote success; got %q", stderr.String())
	}
}

func TestRunSyncCachedFallback(t *testing.T) {
	home := withCSBXHome(t)
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	cached := []byte("version: 1\nplugins:\n  marker:\n    repo: r\n    type: tool\n")
	if err := os.WriteFile(filepath.Join(home, "registry.yaml"), cached, 0o644); err != nil {
		t.Fatal(err)
	}

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runSync(context.Background(), &fakeSyncFetcher{err: errors.New("net down")}, stdout, stderr); err != nil {
		t.Fatalf("runSync: %v", err)
	}
	if !strings.Contains(stderr.String(), "keeping cached") {
		t.Errorf("expected cached-fallback marker on stderr; got %q", stderr.String())
	}
}

func TestRunSyncBaselineFallback(t *testing.T) {
	withCSBXHome(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if err := runSync(context.Background(), &fakeSyncFetcher{err: errors.New("dns")}, stdout, stderr); err != nil {
		t.Fatalf("runSync: %v", err)
	}
	if !strings.Contains(stderr.String(), "embedded baseline") {
		t.Errorf("expected baseline marker on stderr; got %q", stderr.String())
	}
}

func TestRunSyncWritesValidRegistry(t *testing.T) {
	home := withCSBXHome(t)
	stdout, _ := &bytes.Buffer{}, &bytes.Buffer{}
	body := []byte("version: 1\nplugins:\n  acme:\n    repo: https://example.com/x\n    type: tool\n")
	if err := runSync(context.Background(), &fakeSyncFetcher{body: body}, stdout, &bytes.Buffer{}); err != nil {
		t.Fatalf("runSync: %v", err)
	}
	// And the post-sync registry should LoadRegistry cleanly.
	t.Setenv("CSBX_HOME", home)
	paths, err := csbxstate.NewPaths()
	if err != nil {
		t.Fatal(err)
	}
	reg, err := paths.LoadRegistry()
	if err != nil {
		t.Fatalf("LoadRegistry post-sync: %v", err)
	}
	if _, ok := reg.Plugins["acme"]; !ok {
		t.Errorf("acme not in post-sync registry; got %v", reg.Plugins)
	}
}
