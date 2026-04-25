// Package ollama is a minimal client for a local Ollama daemon's HTTP API.
//
// We implement only what invoke-ollama needs: a non-streaming POST to
// /api/generate (with optional system prompt and JSON-format flag) and a
// GET to /api/tags for `--list`. No streaming, no chat-history threading,
// no embeddings — those belong in a higher-level helper if/when needed.
//
// The client takes an *http.Client so tests can drive an httptest.Server
// without touching a live daemon. Default timeouts mirror the bash
// invoke-ollama defaults (300s overall, 5s connect) so behaviour matches
// when no overrides are supplied.
package ollama

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Defaults mirror the bash invoke-ollama script and Ollama's published
// API conventions. OLLAMA_HOST is the legacy env var name; we keep it
// rather than introducing a new one so existing scripts continue to work
// after the bash file becomes a shim around this package.
const (
	DefaultEndpoint = "http://localhost:11434"
	DefaultModel    = "llama3.1"

	GeneratePath = "/api/generate"
	TagsPath     = "/api/tags"

	// Generate is long-running by design — local models on CPU can take
	// minutes. 300s mirrors the bash OLLAMA_TIMEOUT default; tests
	// override via the HTTPClient.
	DefaultTimeout = 300 * time.Second
)

// Config carries everything needed to make a request. Zero values fall
// back to the constants above.
type Config struct {
	Endpoint   string
	HTTPClient *http.Client
}

// Client is the typed entry point. Construct via New so the defaults are
// applied consistently.
type Client struct {
	cfg Config
}

func New(cfg Config) *Client {
	if cfg.Endpoint == "" {
		cfg.Endpoint = DefaultEndpoint
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: DefaultTimeout}
	}
	// Trim a trailing slash so we can reliably concatenate paths below.
	cfg.Endpoint = strings.TrimRight(cfg.Endpoint, "/")
	return &Client{cfg: cfg}
}

// Request mirrors the relevant subset of Ollama's /api/generate payload.
// `Stream` is forced to false in Send — the streaming protocol is a
// different beast we don't need yet.
type Request struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	System string `json:"system,omitempty"`
	// Format is "json" when JSON mode is requested; empty otherwise.
	// Ollama treats any other value as "no format constraint".
	Format string `json:"format,omitempty"`
	Stream bool   `json:"stream"`
}

// Response is the trimmed payload we read back. Ollama returns more
// fields (created_at, done_reason, prompt_eval_count, etc.) that we
// ignore — encoding/json drops unknown fields silently.
type Response struct {
	Response      string `json:"response"`
	Model         string `json:"model"`
	TotalDuration int64  `json:"total_duration"` // nanoseconds
	EvalCount     int    `json:"eval_count"`     // output tokens
	Done          bool   `json:"done"`
	Error         string `json:"error,omitempty"`
}

// TagsResponse is the shape returned by GET /api/tags. We only surface
// the fields invoke-ollama --list cares about (name + size + parameter
// size). Anything else Ollama emits gets ignored on decode.
type TagsResponse struct {
	Models []ModelTag `json:"models"`
}

type ModelTag struct {
	Name    string         `json:"name"`
	Size    int64          `json:"size"`
	Details ModelTagDetail `json:"details"`
}

type ModelTagDetail struct {
	ParameterSize string `json:"parameter_size"`
}

// Generate issues a non-streaming completion request. A populated
// `error` field in the body is surfaced as a Go error so callers don't
// have to inspect both the HTTP status and the JSON.
func (c *Client) Generate(ctx context.Context, req Request) (*Response, error) {
	if req.Model == "" {
		req.Model = DefaultModel
	}
	req.Stream = false

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.Endpoint+GeneratePath, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build http request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	httpResp, err := c.cfg.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ollama request: %w", err)
	}
	defer httpResp.Body.Close()

	respBytes, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var resp Response
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return nil, fmt.Errorf("decode response (status %d, body=%q): %w",
			httpResp.StatusCode, string(respBytes), err)
	}

	if resp.Error != "" {
		return &resp, fmt.Errorf("ollama api error: %s", resp.Error)
	}
	if httpResp.StatusCode >= 400 {
		return &resp, fmt.Errorf("ollama http %d: %s", httpResp.StatusCode, strings.TrimSpace(string(respBytes)))
	}
	return &resp, nil
}

// ListModels queries /api/tags. Used by `invoke-ollama --list`. A
// daemon that isn't running surfaces as a connection error from the
// underlying HTTP client.
func (c *Client) ListModels(ctx context.Context) (*TagsResponse, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.Endpoint+TagsPath, nil)
	if err != nil {
		return nil, fmt.Errorf("build http request: %w", err)
	}

	httpResp, err := c.cfg.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ollama tags request: %w", err)
	}
	defer httpResp.Body.Close()

	respBytes, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("read tags response: %w", err)
	}

	if httpResp.StatusCode >= 400 {
		return nil, fmt.Errorf("ollama http %d: %s", httpResp.StatusCode, strings.TrimSpace(string(respBytes)))
	}

	var tags TagsResponse
	if err := json.Unmarshal(respBytes, &tags); err != nil {
		return nil, fmt.Errorf("decode tags response (body=%q): %w", string(respBytes), err)
	}
	return &tags, nil
}

// Ping returns nil if the daemon is reachable. Used by the CLI to give a
// clearer error than a generic curl-style failure ("Ollama not running
// at $OLLAMA_HOST — start it: ollama serve").
func (c *Client) Ping(ctx context.Context) error {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.Endpoint+TagsPath, nil)
	if err != nil {
		return err
	}
	resp, err := c.cfg.HTTPClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// Any 2xx-4xx response means the daemon answered the socket. 5xx is
	// also "alive but unhappy" — still a successful ping for reachability.
	if resp.StatusCode >= 200 && resp.StatusCode < 600 {
		return nil
	}
	return errors.New("ollama returned no usable status")
}

// DurationSeconds converts the nanosecond total_duration from Generate
// into a float seconds value the CLI prints in the dim usage footer.
// Returns 0 if the response is nil or the duration is non-positive.
func (r *Response) DurationSeconds() float64 {
	if r == nil || r.TotalDuration <= 0 {
		return 0
	}
	return float64(r.TotalDuration) / float64(time.Second)
}
