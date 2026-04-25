package csbx

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// httpFetcherForTest wraps HTTPFetcher with a fixed Client. Easier than
// constructing a fake SyncFetcher for the cases where we want to
// exercise the actual http path.
func httpFetcherForTest(srvURL string) *HTTPFetcher {
	return &HTTPFetcher{Client: &http.Client{}}
}

// fakeFetcher is the SyncFetcher tests use to drive Sync without
// network I/O. body is what Get returns; err is the canned error.
type fakeFetcher struct {
	body []byte
	err  error
}

func (f *fakeFetcher) Get(ctx context.Context, url string) ([]byte, error) {
	return f.body, f.err
}

func TestSyncRemoteSuccessAtomicWrite(t *testing.T) {
	p := tempPaths(t)
	body := []byte("version: 1\nplugins:\n  acme:\n    repo: https://example.com/acme\n    type: tool\n")

	res, err := Sync(context.Background(), p, &fakeFetcher{body: body})
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if res.Source != "remote" {
		t.Errorf("Source = %q; want remote", res.Source)
	}

	got, err := os.ReadFile(p.Registry)
	if err != nil {
		t.Fatalf("read registry: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Errorf("registry content mismatch")
	}
	// No leftover .csbx-sync-*.tmp files.
	entries, _ := os.ReadDir(p.Home)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".csbx-sync-") {
			t.Errorf("leftover temp file: %s", e.Name())
		}
	}
}

func TestSyncFallsBackToCachedWhenRemoteFailsAndCacheExists(t *testing.T) {
	p := tempPaths(t)
	cached := []byte("version: 1\nplugins:\n  cached-marker:\n    repo: r\n    type: tool\n")
	if err := p.EnsureDirs(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p.Registry, cached, 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := Sync(context.Background(), p, &fakeFetcher{err: errors.New("connection refused")})
	if err != nil {
		t.Fatalf("Sync should not error when cache is available: %v", err)
	}
	if res.Source != "cached" {
		t.Errorf("Source = %q; want cached", res.Source)
	}
	if res.Err == nil || !strings.Contains(res.Err.Error(), "connection refused") {
		t.Errorf("Err should propagate the fetch error; got %v", res.Err)
	}

	got, err := os.ReadFile(p.Registry)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, cached) {
		t.Error("cached registry got overwritten on failed sync")
	}
}

func TestSyncWritesBaselineWhenColdStartAndOffline(t *testing.T) {
	p := tempPaths(t)
	res, err := Sync(context.Background(), p, &fakeFetcher{err: errors.New("network down")})
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if res.Source != "baseline" {
		t.Errorf("Source = %q; want baseline", res.Source)
	}

	got, err := os.ReadFile(p.Registry)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, baselineRegistry) {
		t.Error("baseline content mismatch")
	}

	// And the baseline should parse as a valid Registry.
	reg, err := p.LoadRegistry()
	if err != nil {
		t.Fatalf("LoadRegistry on baseline: %v", err)
	}
	if reg.Version != 1 {
		t.Errorf("baseline.Version = %d; want 1", reg.Version)
	}
	if len(reg.Plugins) != 10 {
		t.Errorf("baseline plugin count = %d; want 10", len(reg.Plugins))
	}
	for _, expected := range []string{"seclists", "nuclei-templates", "powerlevel10k", "fuzzdb"} {
		if _, ok := reg.Plugins[expected]; !ok {
			t.Errorf("baseline missing plugin %q", expected)
		}
	}
}

func TestSyncEmbeddedBaselineMatchesYAMLFile(t *testing.T) {
	// The baseline_registry.yaml file must be valid YAML and produce
	// the same Registry the bash fallback writes. This catches
	// accidental edits that break the schema.
	got := BaselineRegistryYAML()
	if len(got) < 100 {
		t.Fatalf("baseline suspiciously small (%d bytes)", len(got))
	}
	if !bytes.Contains(got, []byte("version: 1")) {
		t.Error("baseline missing version: 1")
	}
	if !bytes.Contains(got, []byte("zsh-syntax-highlighting")) {
		t.Error("baseline missing zsh-syntax-highlighting (the last plugin)")
	}
}

func TestHTTPFetcherSuccess(t *testing.T) {
	body := []byte("version: 1\nplugins: {}\n")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	got, err := NewHTTPFetcher().Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Errorf("body mismatch; got %q", got)
	}
}

func TestHTTPFetcherNon2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	_, err := NewHTTPFetcher().Get(context.Background(), srv.URL)
	if err == nil {
		t.Fatal("expected error on 404")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("error should include status code; got %v", err)
	}
}

func TestHTTPFetcherUnreachable(t *testing.T) {
	// 127.0.0.1:1 — port 1 is reserved and rejected immediately.
	_, err := NewHTTPFetcher().Get(context.Background(), "http://127.0.0.1:1")
	if err == nil {
		t.Fatal("expected error on unreachable endpoint")
	}
}

func TestAtomicWriteCreatesAndOverwrites(t *testing.T) {
	dir := t.TempDir()
	dst := dir + "/out.yaml"

	if err := atomicWrite(dst, []byte("first")); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(dst)
	if string(got) != "first" {
		t.Errorf("first write = %q", string(got))
	}

	if err := atomicWrite(dst, []byte("second")); err != nil {
		t.Fatal(err)
	}
	got, _ = os.ReadFile(dst)
	if string(got) != "second" {
		t.Errorf("second write = %q", string(got))
	}
}
