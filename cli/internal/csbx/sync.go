package csbx

import (
	_ "embed"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// baselineRegistry is the embedded fallback when CSBX_REGISTRY_URL is
// unreachable AND no cached registry exists yet. Mirrors bash csbx:124-187
// — same 10 plugins. Update both files together when the upstream
// catalog adds entries.
//
//go:embed baseline_registry.yaml
var baselineRegistry []byte

// SyncResult captures the outcome of a registry sync. Source is one of
// "remote" (downloaded fresh) or "baseline" (fell back to embedded).
// Cached means we kept what was already on disk because the download
// failed and the cached copy was non-empty.
type SyncResult struct {
	Source string // "remote", "baseline", or "cached"
	URL    string // origin URL when Source == "remote"
	Path   string // resolved on-disk path
	Err    error  // populated when Source != "remote"
}

// SyncFetcher abstracts the HTTP GET so tests can inject httptest. The
// production impl is httpFetcher (uses net/http with a 10s timeout).
type SyncFetcher interface {
	Get(ctx context.Context, url string) ([]byte, error)
}

// HTTPFetcher uses net/http with a sensible default timeout. Override
// the timeout via the Client field if you need a different deadline.
type HTTPFetcher struct {
	Client *http.Client
}

// DefaultSyncTimeout is the wall-clock cap for a single registry GET.
// Mirrors the bash csbx's `curl -fsSL` defaults plus a finite ceiling.
const DefaultSyncTimeout = 10 * time.Second

// NewHTTPFetcher returns a SyncFetcher with the default timeout.
func NewHTTPFetcher() *HTTPFetcher {
	return &HTTPFetcher{Client: &http.Client{Timeout: DefaultSyncTimeout}}
}

// Get implements SyncFetcher. Returns an error for any non-2xx status
// or for connection failures; the caller (Sync) decides whether to
// fall back to cached or baseline.
func (f *HTTPFetcher) Get(ctx context.Context, url string) ([]byte, error) {
	client := f.Client
	if client == nil {
		client = &http.Client{Timeout: DefaultSyncTimeout}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build registry request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("registry GET %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("registry GET %s: HTTP %d", url, resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read registry body: %w", err)
	}
	return body, nil
}

// Sync downloads CSBX_REGISTRY_URL into p.Registry. The fallback chain
// matches bash csbx:112-191:
//
//  1. HTTP GET succeeds → write to a temp file in $CSBX_HOME, atomic
//     rename over p.Registry. Source = "remote".
//  2. HTTP GET fails AND p.Registry already exists → keep the cached
//     copy untouched. Source = "cached".
//  3. HTTP GET fails AND no cached registry → write the embedded
//     baseline. Source = "baseline".
//
// EnsureDirs is called first so a fresh $CSBX_HOME boots correctly.
func Sync(ctx context.Context, p *Paths, f SyncFetcher) (*SyncResult, error) {
	if err := p.EnsureDirs(); err != nil {
		return nil, err
	}

	body, fetchErr := f.Get(ctx, p.RegistryURL)
	if fetchErr == nil {
		if err := atomicWrite(p.Registry, body); err != nil {
			return nil, fmt.Errorf("write registry: %w", err)
		}
		return &SyncResult{Source: "remote", URL: p.RegistryURL, Path: p.Registry}, nil
	}

	// Remote unreachable — keep the cache if we have one.
	if _, err := os.Stat(p.Registry); err == nil {
		return &SyncResult{Source: "cached", URL: p.RegistryURL, Path: p.Registry, Err: fetchErr}, nil
	}

	// Cold start with no network — write the embedded baseline.
	if err := atomicWrite(p.Registry, baselineRegistry); err != nil {
		return nil, fmt.Errorf("write baseline registry: %w", err)
	}
	return &SyncResult{Source: "baseline", URL: p.RegistryURL, Path: p.Registry, Err: fetchErr}, nil
}

// atomicWrite writes content to a temp file in the same directory then
// renames over dst. Same atomicity guarantee as SaveInstalled — a
// partial write or crash mid-flight cannot corrupt dst.
func atomicWrite(dst string, content []byte) error {
	dir := filepath.Dir(dst)
	tmp, err := os.CreateTemp(dir, ".csbx-sync-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp file in %s: %w", dir, err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op when rename succeeded
	if _, err := tmp.Write(content); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Rename(tmpName, dst); err != nil {
		return fmt.Errorf("rename to %s: %w", dst, err)
	}
	return nil
}

// BaselineRegistryYAML returns a copy of the embedded baseline so
// callers can inspect it without touching disk. Useful for tests and
// for `cyberbox csbx sync --print-baseline` if we ever add it.
func BaselineRegistryYAML() []byte {
	out := make([]byte, len(baselineRegistry))
	copy(out, baselineRegistry)
	return out
}

// errors emitted by Sync — exposed so tests can assert against them.
var (
	ErrSyncNoNetworkNoCache = errors.New("registry unreachable and no cached copy")
)
