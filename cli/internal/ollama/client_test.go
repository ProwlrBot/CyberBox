package ollama

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// newFakeAPI returns a httptest server whose handler dispatches by path:
// /api/generate echoes a configurable Response, /api/tags echoes a
// configurable TagsResponse. The capture pointers (if non-nil) record
// the most recent inbound Generate request body so tests can assert
// what the client sent.
func newFakeAPI(t *testing.T, capturedGen *Request, genReply Response, tagsReply TagsResponse) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc(GeneratePath, func(w http.ResponseWriter, r *http.Request) {
		if capturedGen != nil {
			_ = json.NewDecoder(r.Body).Decode(capturedGen)
		}
		_ = json.NewEncoder(w).Encode(genReply)
	})
	mux.HandleFunc(TagsPath, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(tagsReply)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestGenerateHappyPath(t *testing.T) {
	var captured Request
	srv := newFakeAPI(t, &captured, Response{
		Response:      "this is the model output",
		Model:         "llama3.1",
		TotalDuration: int64(2 * time.Second),
		EvalCount:     42,
		Done:          true,
	}, TagsResponse{})

	c := New(Config{Endpoint: srv.URL})
	resp, err := c.Generate(context.Background(), Request{
		Model:  "llama3.1",
		Prompt: "hello",
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if resp.Response != "this is the model output" {
		t.Errorf("Response = %q; want body text", resp.Response)
	}
	if resp.EvalCount != 42 {
		t.Errorf("EvalCount = %d; want 42", resp.EvalCount)
	}
	if got := resp.DurationSeconds(); got != 2.0 {
		t.Errorf("DurationSeconds = %v; want 2.0", got)
	}
	// Stream MUST be false on the wire — we don't support streaming.
	if captured.Stream {
		t.Error("Generate sent stream=true; client must always force false")
	}
	if captured.Model != "llama3.1" {
		t.Errorf("captured.Model = %q; want llama3.1", captured.Model)
	}
}

func TestGenerateAppliesDefaultModel(t *testing.T) {
	var captured Request
	srv := newFakeAPI(t, &captured, Response{Response: "ok", Done: true}, TagsResponse{})

	c := New(Config{Endpoint: srv.URL})
	if _, err := c.Generate(context.Background(), Request{Prompt: "hi"}); err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if captured.Model != DefaultModel {
		t.Errorf("captured.Model = %q; want default %q", captured.Model, DefaultModel)
	}
}

func TestGenerateForwardsSystemAndJSONFormat(t *testing.T) {
	var captured Request
	srv := newFakeAPI(t, &captured, Response{Response: `{"k":1}`, Done: true}, TagsResponse{})

	c := New(Config{Endpoint: srv.URL})
	if _, err := c.Generate(context.Background(), Request{
		Model:  "llama3.1",
		Prompt: "extract endpoints",
		System: "You are a security analyst.",
		Format: "json",
	}); err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if captured.System != "You are a security analyst." {
		t.Errorf("System mismatch: %q", captured.System)
	}
	if captured.Format != "json" {
		t.Errorf("Format mismatch: %q", captured.Format)
	}
}

func TestGenerateSurfacesAPIError(t *testing.T) {
	srv := newFakeAPI(t, nil, Response{Error: "model 'made-up' not found"}, TagsResponse{})

	c := New(Config{Endpoint: srv.URL})
	_, err := c.Generate(context.Background(), Request{Model: "made-up", Prompt: "hi"})
	if err == nil {
		t.Fatal("expected error from API error field")
	}
	if !strings.Contains(err.Error(), "model 'made-up' not found") {
		t.Errorf("error should include API message; got %v", err)
	}
}

func TestGenerateSurfacesHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := New(Config{Endpoint: srv.URL})
	_, err := c.Generate(context.Background(), Request{Model: "x", Prompt: "y"})
	if err == nil {
		t.Fatal("expected error on HTTP 500")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("error should include HTTP code; got %v", err)
	}
}

func TestListModelsParses(t *testing.T) {
	srv := newFakeAPI(t, nil, Response{}, TagsResponse{
		Models: []ModelTag{
			{Name: "llama3.1:latest", Size: 4_700_000_000, Details: ModelTagDetail{ParameterSize: "8.0B"}},
			{Name: "deepseek-r1:7b", Size: 4_300_000_000, Details: ModelTagDetail{ParameterSize: "7.0B"}},
		},
	})

	c := New(Config{Endpoint: srv.URL})
	tags, err := c.ListModels(context.Background())
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if len(tags.Models) != 2 {
		t.Fatalf("got %d models; want 2", len(tags.Models))
	}
	if tags.Models[0].Name != "llama3.1:latest" {
		t.Errorf("first model name = %q; want llama3.1:latest", tags.Models[0].Name)
	}
	if tags.Models[1].Details.ParameterSize != "7.0B" {
		t.Errorf("second model parameter_size = %q; want 7.0B", tags.Models[1].Details.ParameterSize)
	}
}

func TestPingReachesDaemon(t *testing.T) {
	srv := newFakeAPI(t, nil, Response{}, TagsResponse{})

	c := New(Config{Endpoint: srv.URL})
	if err := c.Ping(context.Background()); err != nil {
		t.Errorf("Ping should succeed against live server; got %v", err)
	}
}

func TestPingFailsAgainstUnreachable(t *testing.T) {
	// Use an unroutable address with a tight timeout so the test stays fast.
	c := New(Config{
		Endpoint:   "http://127.0.0.1:1",
		HTTPClient: &http.Client{Timeout: 200 * time.Millisecond},
	})
	if err := c.Ping(context.Background()); err == nil {
		t.Error("Ping should fail against unreachable endpoint")
	}
}

func TestNewTrimsTrailingSlash(t *testing.T) {
	c := New(Config{Endpoint: "http://localhost:11434/"})
	if c.cfg.Endpoint != "http://localhost:11434" {
		t.Errorf("trailing slash not trimmed: %q", c.cfg.Endpoint)
	}
}

func TestNewAppliesDefaults(t *testing.T) {
	c := New(Config{})
	if c.cfg.Endpoint != DefaultEndpoint {
		t.Errorf("default endpoint not applied: %q", c.cfg.Endpoint)
	}
	if c.cfg.HTTPClient == nil {
		t.Error("default HTTPClient not applied")
	}
}

func TestDurationSecondsZeroForNil(t *testing.T) {
	var r *Response
	if got := r.DurationSeconds(); got != 0 {
		t.Errorf("nil DurationSeconds = %v; want 0", got)
	}
	r = &Response{TotalDuration: 0}
	if got := r.DurationSeconds(); got != 0 {
		t.Errorf("zero DurationSeconds = %v; want 0", got)
	}
}
