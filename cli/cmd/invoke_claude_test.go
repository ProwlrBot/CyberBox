package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/ProwlrBot/CyberBox/cli/internal/anthropic"
)

// withAPIKey sets ANTHROPIC_API_KEY for the test and clears any pre-existing
// CLAUDE_API_KEY so the precedence test isn't flaky on developer laptops.
func withAPIKey(t *testing.T, key string) {
	t.Helper()
	t.Setenv("ANTHROPIC_API_KEY", key)
	t.Setenv("CLAUDE_API_KEY", "")
}

func newFakeAPI(t *testing.T, capture *anthropic.Request, reply anthropic.Response) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if capture != nil {
			_ = json.NewDecoder(r.Body).Decode(capture)
		}
		_ = json.NewEncoder(w).Encode(reply)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestInvokeClaudeHappyPath(t *testing.T) {
	withAPIKey(t, "test-key")
	var captured anthropic.Request
	srv := newFakeAPI(t, &captured, anthropic.Response{
		Content: []anthropic.ContentBlock{{Type: "text", Text: "vuln explanation"}},
		Usage:   anthropic.Usage{InputTokens: 12, OutputTokens: 7},
	})
	t.Setenv("CLAUDE_ENDPOINT", srv.URL)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeClaude(
		context.Background(),
		&invokeClaudeOpts{model: "opus", maxTokens: 1000, rawOutput: true},
		[]string{"explain", "this", "vuln"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err != nil {
		t.Fatalf("runInvokeClaude: %v", err)
	}

	if !strings.Contains(stdout.String(), "vuln explanation") {
		t.Errorf("stdout missing API text: %q", stdout.String())
	}
	if captured.Model != anthropic.ModelOpus {
		t.Errorf("model = %q; want %q (alias resolution)", captured.Model, anthropic.ModelOpus)
	}
	if got := captured.Messages[0].Content; got != "explain this vuln" {
		t.Errorf("prompt = %q; want concatenated args", got)
	}
}

func TestInvokeClaudeStdinConcatenated(t *testing.T) {
	withAPIKey(t, "k")
	var captured anthropic.Request
	srv := newFakeAPI(t, &captured, anthropic.Response{
		Content: []anthropic.ContentBlock{{Type: "text", Text: "ok"}},
	})
	t.Setenv("CLAUDE_ENDPOINT", srv.URL)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeClaude(
		context.Background(),
		&invokeClaudeOpts{model: "sonnet", rawOutput: true},
		[]string{"summarise"},
		strings.NewReader("HTTP 200 OK\nbody contents...\n"),
		stdout, stderr,
	)
	if err != nil {
		t.Fatalf("runInvokeClaude: %v", err)
	}

	want := "summarise\n\nHTTP 200 OK\nbody contents..."
	if got := captured.Messages[0].Content; got != want {
		t.Errorf("prompt mismatch:\n  got:  %q\n  want: %q", got, want)
	}
}

func TestInvokeClaudeJSONModeAppendsInstruction(t *testing.T) {
	withAPIKey(t, "k")
	var captured anthropic.Request
	srv := newFakeAPI(t, &captured, anthropic.Response{
		Content: []anthropic.ContentBlock{{Type: "text", Text: `{"k":1}`}},
	})
	t.Setenv("CLAUDE_ENDPOINT", srv.URL)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeClaude(
		context.Background(),
		&invokeClaudeOpts{model: "haiku", jsonMode: true, rawOutput: true},
		[]string{"extract endpoints"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err != nil {
		t.Fatalf("runInvokeClaude: %v", err)
	}

	if !strings.Contains(captured.Messages[0].Content, "Respond ONLY in valid JSON format") {
		t.Errorf("JSON mode did not append instruction; got %q", captured.Messages[0].Content)
	}
}

func TestInvokeClaudeMissingAPIKey(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("CLAUDE_API_KEY", "")
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeClaude(
		context.Background(),
		&invokeClaudeOpts{},
		[]string{"hi"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err == nil {
		t.Fatal("expected error when API key absent")
	}
	if !strings.Contains(stderr.String(), "ANTHROPIC_API_KEY") {
		t.Errorf("stderr should mention ANTHROPIC_API_KEY; got %q", stderr.String())
	}
}

func TestInvokeClaudeNoPrompt(t *testing.T) {
	withAPIKey(t, "k")
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeClaude(
		context.Background(),
		&invokeClaudeOpts{},
		nil,
		strings.NewReader(""),
		stdout, stderr,
	)
	if err == nil {
		t.Fatal("expected error when no prompt provided")
	}
}

func TestInvokeClaudeAPIErrorPropagated(t *testing.T) {
	withAPIKey(t, "k")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(anthropic.Response{
			Error: &anthropic.APIError{Type: "invalid_request_error", Message: "model x not found"},
		})
	}))
	defer srv.Close()
	t.Setenv("CLAUDE_ENDPOINT", srv.URL)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeClaude(
		context.Background(),
		&invokeClaudeOpts{model: "x", rawOutput: true},
		[]string{"hi"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err == nil {
		t.Fatal("expected API error to surface")
	}
	if !strings.Contains(stderr.String(), "model x not found") {
		t.Errorf("stderr should include API error message; got %q", stderr.String())
	}
}

// Sanity check that buildPrompt's stdin handling does not block when given
// a closed reader (regression guard against an early bug where we tried to
// read from os.Stdin unconditionally).
func TestBuildPromptHandlesEmptyReader(t *testing.T) {
	got := buildPrompt([]string{"hello"}, strings.NewReader(""))
	if got != "hello" {
		t.Errorf("got %q; want %q", got, "hello")
	}

	got = buildPrompt(nil, strings.NewReader("piped"))
	if got != "piped" {
		t.Errorf("got %q; want %q", got, "piped")
	}

	got = buildPrompt(nil, strings.NewReader(""))
	if got != "" {
		t.Errorf("got %q; want empty", got)
	}
}

// Ensure os.Stdin's TTY check returns the same result as a non-file reader,
// just for documentation — strings.NewReader is not a *os.File, hence false.
func TestIsTerminalNonFileReturnsFalse(t *testing.T) {
	var r io.Reader = strings.NewReader("")
	if isTerminal(r) {
		t.Error("isTerminal(strings.NewReader) should be false")
	}
	if isTerminal(os.NewFile(0, "")) != term_OnFakeFd() {
		// os.NewFile(0, "") yields a file with fd=0; whether that's a tty
		// depends on the test runner's stdin. We don't assert a specific
		// value, just that the function does not panic.
	}
}

// term_OnFakeFd is a tiny indirection so the comment above isn't a lie:
// we only call this to keep the compiler from optimising the call away.
func term_OnFakeFd() bool { return false }
