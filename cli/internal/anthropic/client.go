// Package anthropic is a minimal client for the Anthropic Messages API.
//
// We only implement what invoke-claude needs: a single non-streaming POST
// to /v1/messages with optional system prompt, returning the first content
// block plus token usage. No streaming, no batching, no caching — those
// belong in a higher-level helper if/when we need them.
//
// The client takes an *http.Client so tests can drive an httptest.Server.
package anthropic

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

// Default endpoint and model IDs mirror the bash invoke-claude defaults so
// behaviour is identical when no overrides are supplied.
const (
	DefaultEndpoint   = "https://api.anthropic.com/v1/messages"
	DefaultAPIVersion = "2023-06-01"

	ModelSonnet = "claude-sonnet-4-20250514"
	ModelOpus   = "claude-opus-4-20250514"
	ModelHaiku  = "claude-haiku-4-5-20251001"

	DefaultMaxTokens = 4096
	DefaultTimeout   = 120 * time.Second
)

// ResolveModel maps the bash CLI's short aliases (sonnet/s, opus/o, haiku/h)
// to full model IDs. Unrecognised inputs pass through unchanged so callers
// can pin custom model names.
func ResolveModel(alias string) string {
	switch strings.ToLower(alias) {
	case "sonnet", "s", "":
		return ModelSonnet
	case "opus", "o":
		return ModelOpus
	case "haiku", "h":
		return ModelHaiku
	default:
		return alias
	}
}

// Config carries everything needed to make a request. Zero values fall back
// to the defaults above.
type Config struct {
	APIKey     string
	Endpoint   string
	APIVersion string
	HTTPClient *http.Client
}

// Client is the typed entry point.
type Client struct {
	cfg Config
}

func New(cfg Config) *Client {
	if cfg.Endpoint == "" {
		cfg.Endpoint = DefaultEndpoint
	}
	if cfg.APIVersion == "" {
		cfg.APIVersion = DefaultAPIVersion
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: DefaultTimeout}
	}
	return &Client{cfg: cfg}
}

// Request mirrors the relevant subset of the Messages API payload.
type Request struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	System    string    `json:"system,omitempty"`
	Messages  []Message `json:"messages"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Response is the trimmed payload we read back. Fields we don't use are
// ignored by encoding/json without complaint.
type Response struct {
	Content []ContentBlock `json:"content"`
	Usage   Usage          `json:"usage"`
	Error   *APIError      `json:"error,omitempty"`
}

type ContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type APIError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// Send issues the request and returns the response. A non-2xx HTTP status
// or a populated `error` field in the body is surfaced as a Go error so
// callers don't have to inspect both.
func (c *Client) Send(ctx context.Context, req Request) (*Response, error) {
	if c.cfg.APIKey == "" {
		return nil, errors.New("missing API key")
	}
	if req.MaxTokens == 0 {
		req.MaxTokens = DefaultMaxTokens
	}
	if req.Model == "" {
		req.Model = ModelSonnet
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.Endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build http request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.cfg.APIKey)
	httpReq.Header.Set("anthropic-version", c.cfg.APIVersion)

	httpResp, err := c.cfg.HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("anthropic request: %w", err)
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

	if resp.Error != nil && resp.Error.Message != "" {
		return &resp, fmt.Errorf("anthropic api error: %s", resp.Error.Message)
	}
	if httpResp.StatusCode >= 400 {
		return &resp, fmt.Errorf("anthropic http %d: %s", httpResp.StatusCode, strings.TrimSpace(string(respBytes)))
	}
	return &resp, nil
}

// FirstText returns the first content block's text, matching the bash
// implementation's `jq -r '.content[0].text // empty'` extraction.
func (r *Response) FirstText() string {
	if r == nil || len(r.Content) == 0 {
		return ""
	}
	return r.Content[0].Text
}
