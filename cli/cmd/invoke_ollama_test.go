package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ProwlrBot/CyberBox/cli/internal/ollama"
)

// newFakeOllamaAPI mirrors newFakeAPI in invoke_claude_test.go but for
// Ollama's two endpoints. capture (if non-nil) records the most recent
// /api/generate request payload.
func newFakeOllamaAPI(t *testing.T, capture *ollama.Request, genReply ollama.Response, tagsReply ollama.TagsResponse) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc(ollama.GeneratePath, func(w http.ResponseWriter, r *http.Request) {
		if capture != nil {
			_ = json.NewDecoder(r.Body).Decode(capture)
		}
		_ = json.NewEncoder(w).Encode(genReply)
	})
	mux.HandleFunc(ollama.TagsPath, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(tagsReply)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestInvokeOllamaHappyPath(t *testing.T) {
	var captured ollama.Request
	srv := newFakeOllamaAPI(t, &captured, ollama.Response{
		Response:      "triage explanation",
		Model:         "llama3.1",
		TotalDuration: int64(3 * time.Second),
		EvalCount:     128,
		Done:          true,
	}, ollama.TagsResponse{})
	t.Setenv("OLLAMA_HOST", srv.URL)
	t.Setenv("OLLAMA_MODEL", "")

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{model: "deepseek-r1", rawOutput: true},
		[]string{"triage", "this", "finding"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err != nil {
		t.Fatalf("runInvokeOllama: %v", err)
	}

	if !strings.Contains(stdout.String(), "triage explanation") {
		t.Errorf("stdout missing API text: %q", stdout.String())
	}
	if captured.Model != "deepseek-r1" {
		t.Errorf("model = %q; want deepseek-r1 (flag took precedence)", captured.Model)
	}
	if captured.Stream {
		t.Error("client must always send stream=false; got true")
	}
	if got := captured.Prompt; got != "triage this finding" {
		t.Errorf("prompt = %q; want concatenated args", got)
	}
}

func TestInvokeOllamaModelEnvFallback(t *testing.T) {
	var captured ollama.Request
	srv := newFakeOllamaAPI(t, &captured, ollama.Response{Response: "ok", Done: true}, ollama.TagsResponse{})
	t.Setenv("OLLAMA_HOST", srv.URL)
	t.Setenv("OLLAMA_MODEL", "deepseek-r1:7b")

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{rawOutput: true}, // no -m flag
		[]string{"hi"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err != nil {
		t.Fatalf("runInvokeOllama: %v", err)
	}
	if captured.Model != "deepseek-r1:7b" {
		t.Errorf("model = %q; want OLLAMA_MODEL value", captured.Model)
	}
}

func TestInvokeOllamaModelDefaultsToLlama(t *testing.T) {
	var captured ollama.Request
	srv := newFakeOllamaAPI(t, &captured, ollama.Response{Response: "ok", Done: true}, ollama.TagsResponse{})
	t.Setenv("OLLAMA_HOST", srv.URL)
	t.Setenv("OLLAMA_MODEL", "")

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{rawOutput: true},
		[]string{"hi"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err != nil {
		t.Fatalf("runInvokeOllama: %v", err)
	}
	if captured.Model != ollama.DefaultModel {
		t.Errorf("model = %q; want default %q", captured.Model, ollama.DefaultModel)
	}
}

func TestInvokeOllamaStdinConcatenated(t *testing.T) {
	var captured ollama.Request
	srv := newFakeOllamaAPI(t, &captured, ollama.Response{Response: "ok", Done: true}, ollama.TagsResponse{})
	t.Setenv("OLLAMA_HOST", srv.URL)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{rawOutput: true},
		[]string{"summarise"},
		strings.NewReader("HTTP 200 OK\nbody contents...\n"),
		stdout, stderr,
	)
	if err != nil {
		t.Fatalf("runInvokeOllama: %v", err)
	}
	want := "summarise\n\nHTTP 200 OK\nbody contents..."
	if got := captured.Prompt; got != want {
		t.Errorf("prompt mismatch:\n  got:  %q\n  want: %q", got, want)
	}
}

func TestInvokeOllamaJSONModeSetsFormat(t *testing.T) {
	var captured ollama.Request
	srv := newFakeOllamaAPI(t, &captured, ollama.Response{Response: `{"k":1}`, Done: true}, ollama.TagsResponse{})
	t.Setenv("OLLAMA_HOST", srv.URL)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{jsonMode: true, rawOutput: true},
		[]string{"extract endpoints"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err != nil {
		t.Fatalf("runInvokeOllama: %v", err)
	}
	if captured.Format != "json" {
		t.Errorf("Format = %q; want \"json\"", captured.Format)
	}
}

func TestInvokeOllamaSystemPromptForwarded(t *testing.T) {
	var captured ollama.Request
	srv := newFakeOllamaAPI(t, &captured, ollama.Response{Response: "ok", Done: true}, ollama.TagsResponse{})
	t.Setenv("OLLAMA_HOST", srv.URL)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{system: "You are a security analyst.", rawOutput: true},
		[]string{"hi"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err != nil {
		t.Fatalf("runInvokeOllama: %v", err)
	}
	if captured.System != "You are a security analyst." {
		t.Errorf("System = %q; want forwarded value", captured.System)
	}
}

func TestInvokeOllamaNoPrompt(t *testing.T) {
	srv := newFakeOllamaAPI(t, nil, ollama.Response{}, ollama.TagsResponse{})
	t.Setenv("OLLAMA_HOST", srv.URL)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{rawOutput: true},
		nil,
		strings.NewReader(""),
		stdout, stderr,
	)
	if err == nil {
		t.Fatal("expected error when no prompt provided")
	}
}

func TestInvokeOllamaUnreachableDaemonError(t *testing.T) {
	t.Setenv("OLLAMA_HOST", "http://127.0.0.1:1") // unroutable
	t.Setenv("OLLAMA_MODEL", "")

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{rawOutput: true},
		[]string{"hi"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err == nil {
		t.Fatal("expected error when daemon unreachable")
	}
	// The hint must be discoverable — bash version users grep for "ollama serve".
	if !strings.Contains(stderr.String(), "ollama serve") {
		t.Errorf("stderr should hint 'ollama serve'; got %q", stderr.String())
	}
}

func TestInvokeOllamaAPIErrorPropagated(t *testing.T) {
	srv := newFakeOllamaAPI(t, nil, ollama.Response{Error: "model 'x' not found"}, ollama.TagsResponse{})
	t.Setenv("OLLAMA_HOST", srv.URL)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{model: "x", rawOutput: true},
		[]string{"hi"},
		strings.NewReader(""),
		stdout, stderr,
	)
	if err == nil {
		t.Fatal("expected error to surface")
	}
	if !strings.Contains(stderr.String(), "model 'x' not found") {
		t.Errorf("stderr should include API error; got %q", stderr.String())
	}
}

func TestInvokeOllamaListMode(t *testing.T) {
	srv := newFakeOllamaAPI(t, nil, ollama.Response{}, ollama.TagsResponse{
		Models: []ollama.ModelTag{
			{Name: "llama3.1:latest", Size: 4_700_000_000, Details: ollama.ModelTagDetail{ParameterSize: "8.0B"}},
			{Name: "deepseek-r1:7b", Size: 4_300_000_000, Details: ollama.ModelTagDetail{ParameterSize: "7.0B"}},
		},
	})
	t.Setenv("OLLAMA_HOST", srv.URL)

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{listMode: true},
		nil, // no prompt args needed for --list
		strings.NewReader(""),
		stdout, stderr,
	)
	if err != nil {
		t.Fatalf("runInvokeOllama --list: %v", err)
	}
	out := stdout.String()
	if !strings.Contains(out, "llama3.1:latest") {
		t.Errorf("--list output missing llama3.1:latest; got %q", out)
	}
	if !strings.Contains(out, "deepseek-r1:7b") {
		t.Errorf("--list output missing deepseek-r1:7b; got %q", out)
	}
	if !strings.Contains(out, "8.0B") {
		t.Errorf("--list output missing parameter size 8.0B; got %q", out)
	}
}

func TestInvokeOllamaListModeUnreachable(t *testing.T) {
	t.Setenv("OLLAMA_HOST", "http://127.0.0.1:1")

	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := runInvokeOllama(
		context.Background(),
		&invokeOllamaOpts{listMode: true},
		nil,
		strings.NewReader(""),
		stdout, stderr,
	)
	if err == nil {
		t.Fatal("expected error when daemon unreachable in --list mode")
	}
	if !strings.Contains(stderr.String(), "ollama serve") {
		t.Errorf("stderr should hint 'ollama serve'; got %q", stderr.String())
	}
}
