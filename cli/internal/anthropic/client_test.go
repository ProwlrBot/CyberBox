package anthropic

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResolveModel(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"sonnet", ModelSonnet},
		{"s", ModelSonnet},
		{"", ModelSonnet},
		{"opus", ModelOpus},
		{"o", ModelOpus},
		{"haiku", ModelHaiku},
		{"h", ModelHaiku},
		{"OPUS", ModelOpus}, // case-insensitive
		{"claude-custom-2099", "claude-custom-2099"},
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			if got := ResolveModel(c.in); got != c.want {
				t.Errorf("ResolveModel(%q) = %q; want %q", c.in, got, c.want)
			}
		})
	}
}

func TestSendHappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("x-api-key"); got != "k-test" {
			t.Errorf("missing/wrong x-api-key header: %q", got)
		}
		if got := r.Header.Get("anthropic-version"); got != DefaultAPIVersion {
			t.Errorf("missing/wrong anthropic-version header: %q", got)
		}

		var req Request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Model != ModelOpus {
			t.Errorf("model = %q; want %q", req.Model, ModelOpus)
		}
		if len(req.Messages) != 1 || req.Messages[0].Content != "hello" {
			t.Errorf("unexpected messages: %+v", req.Messages)
		}

		_ = json.NewEncoder(w).Encode(Response{
			Content: []ContentBlock{{Type: "text", Text: "hi back"}},
			Usage:   Usage{InputTokens: 10, OutputTokens: 5},
		})
	}))
	defer srv.Close()

	c := New(Config{APIKey: "k-test", Endpoint: srv.URL})
	resp, err := c.Send(context.Background(), Request{
		Model:    ModelOpus,
		Messages: []Message{{Role: "user", Content: "hello"}},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if got := resp.FirstText(); got != "hi back" {
		t.Errorf("FirstText = %q; want %q", got, "hi back")
	}
	if resp.Usage.InputTokens != 10 || resp.Usage.OutputTokens != 5 {
		t.Errorf("usage mismatch: %+v", resp.Usage)
	}
}

func TestSendAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(Response{
			Error: &APIError{Type: "invalid_request_error", Message: "model not found"},
		})
	}))
	defer srv.Close()

	c := New(Config{APIKey: "k-test", Endpoint: srv.URL})
	_, err := c.Send(context.Background(), Request{
		Model:    "claude-bogus",
		Messages: []Message{{Role: "user", Content: "x"}},
	})
	if err == nil {
		t.Fatal("Send returned nil error for API error response")
	}
	if !strings.Contains(err.Error(), "model not found") {
		t.Errorf("error message %q does not include API error text", err.Error())
	}
}

func TestSendMissingAPIKey(t *testing.T) {
	c := New(Config{APIKey: ""})
	_, err := c.Send(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: "x"}},
	})
	if err == nil {
		t.Fatal("expected error for missing API key")
	}
}

func TestSendDefaultsApplied(t *testing.T) {
	var captured Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&captured)
		_ = json.NewEncoder(w).Encode(Response{
			Content: []ContentBlock{{Type: "text", Text: "ok"}},
		})
	}))
	defer srv.Close()

	c := New(Config{APIKey: "k", Endpoint: srv.URL})
	_, err := c.Send(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: "x"}},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if captured.Model == "" {
		t.Errorf("model default not applied; got empty")
	}
	if captured.MaxTokens == 0 {
		t.Errorf("max_tokens default not applied; got 0")
	}
}
