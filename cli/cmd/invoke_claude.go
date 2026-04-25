package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/ProwlrBot/CyberBox/cli/internal/anthropic"
)

// invokeClaudeOpts holds the parsed flag values. Exposed only inside the
// package; the public surface is the cobra command.
type invokeClaudeOpts struct {
	model     string
	system    string
	maxTokens int
	jsonMode  bool
	rawOutput bool
}

func newInvokeClaudeCmd() *cobra.Command {
	opts := &invokeClaudeOpts{}

	cmd := &cobra.Command{
		Use:   "invoke-claude [prompt]...",
		Short: "Send prompts to the Anthropic Messages API",
		Long: `invoke-claude — Claude API from the terminal.

Reads stdin if connected to a pipe and concatenates it with any prompt args.
Equivalent to the legacy bash invoke-claude script with the same flag surface.`,
		Example: `  cyberbox invoke-claude "explain this vuln"
  cat response.txt | cyberbox invoke-claude "find security issues"
  cyberbox invoke-claude -m opus -s "You are a pentest expert" "analyze this"
  curl -s target.com | cyberbox invoke-claude -j "extract all API endpoints"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runInvokeClaude(cmd.Context(), opts, args, os.Stdin, os.Stdout, os.Stderr)
		},
	}

	cmd.Flags().StringVarP(&opts.model, "model", "m", "sonnet",
		"Model alias (sonnet|opus|haiku) or full model ID")
	cmd.Flags().StringVarP(&opts.system, "system", "s", "",
		"System prompt")
	cmd.Flags().IntVarP(&opts.maxTokens, "tokens", "t", anthropic.DefaultMaxTokens,
		"Max output tokens")
	cmd.Flags().BoolVarP(&opts.jsonMode, "json", "j", false,
		"Append \"Respond ONLY in valid JSON format.\" to the prompt")
	cmd.Flags().BoolVarP(&opts.rawOutput, "raw", "r", false,
		"Raw output: suppress 'thinking…' and token usage on stderr")

	return cmd
}

// runInvokeClaude is the testable core. The cobra wrapper passes real
// os.Std* streams; tests pass bytes.Buffer / bytes.Reader.
func runInvokeClaude(
	ctx context.Context,
	opts *invokeClaudeOpts,
	args []string,
	stdin io.Reader,
	stdout, stderr io.Writer,
) error {
	apiKey := firstNonEmpty(
		os.Getenv("ANTHROPIC_API_KEY"),
		os.Getenv("CLAUDE_API_KEY"),
	)
	if apiKey == "" {
		fmt.Fprintln(stderr, "Error: No API key. Set ANTHROPIC_API_KEY or CLAUDE_API_KEY")
		fmt.Fprintln(stderr, "  export ANTHROPIC_API_KEY=sk-ant-api03-...")
		return errors.New("missing api key")
	}

	prompt := buildPrompt(args, stdin)
	if prompt == "" {
		fmt.Fprintln(stderr, `Error: No prompt provided. Use: invoke-claude "your prompt"`)
		return errors.New("no prompt")
	}
	if opts.jsonMode {
		prompt += "\n\nRespond ONLY in valid JSON format."
	}

	model := anthropic.ResolveModel(opts.model)
	endpoint := envOrDefault("CLAUDE_ENDPOINT", anthropic.DefaultEndpoint)
	apiVersion := envOrDefault("CLAUDE_API_VERSION", anthropic.DefaultAPIVersion)

	if !opts.rawOutput && isTerminal(stderr) {
		dim, reset := colorCodes(stderr)
		fmt.Fprintf(stderr, "%s[claude:%s] thinking...%s\n", dim, modelShortName(model), reset)
	}

	client := anthropic.New(anthropic.Config{
		APIKey:     apiKey,
		Endpoint:   endpoint,
		APIVersion: apiVersion,
	})

	resp, err := client.Send(ctx, anthropic.Request{
		Model:     model,
		MaxTokens: opts.maxTokens,
		System:    opts.system,
		Messages:  []anthropic.Message{{Role: "user", Content: prompt}},
	})
	if err != nil {
		fmt.Fprintf(stderr, "Error: %s\n", err)
		return err
	}

	content := resp.FirstText()
	if content == "" {
		fmt.Fprintln(stderr, "Error: empty response from anthropic")
		return errors.New("empty response")
	}

	fmt.Fprintln(stdout, content)
	if !opts.rawOutput {
		dim, reset := colorCodes(stderr)
		fmt.Fprintf(stderr, "\n%s[tokens: %s in/%s out | model: %s]%s\n",
			dim,
			usageStr(resp.Usage.InputTokens),
			usageStr(resp.Usage.OutputTokens),
			model, reset,
		)
	}
	return nil
}

// buildPrompt mirrors the bash logic: if stdin is non-empty (i.e. piped),
// append it after a blank line to any prompt args. Either piece may be
// empty; emptiness of the result is the caller's responsibility to check.
func buildPrompt(args []string, stdin io.Reader) string {
	prompt := strings.TrimSpace(strings.Join(args, " "))

	stdinData := ""
	if !isTerminal(stdin) {
		// Reading is bounded by stdin's natural EOF (the pipe closes).
		if data, err := io.ReadAll(stdin); err == nil {
			stdinData = strings.TrimRight(string(data), "\n")
		}
	}

	switch {
	case prompt != "" && stdinData != "":
		return prompt + "\n\n" + stdinData
	case prompt != "":
		return prompt
	default:
		return stdinData
	}
}

// isTerminal returns true if v is os.Stdin/Stdout/Stderr (or any *os.File)
// connected to a TTY. Non-files (e.g. bytes.Buffer in tests) return false,
// which matches our "treat tests as non-interactive" assumption.
func isTerminal(v any) bool {
	f, ok := v.(*os.File)
	if !ok {
		return false
	}
	return term.IsTerminal(int(f.Fd()))
}

// colorCodes returns ANSI dim/reset escapes for w if w is a TTY and
// NO_COLOR is unset; otherwise empty strings (no-op formatting).
func colorCodes(w io.Writer) (dim, reset string) {
	if os.Getenv("NO_COLOR") != "" {
		return "", ""
	}
	if !isTerminal(w) {
		return "", ""
	}
	return "\033[90m", "\033[0m"
}

func modelShortName(model string) string {
	if i := strings.LastIndex(model, "-"); i >= 0 {
		return model[i+1:]
	}
	return model
}

func usageStr(n int) string {
	if n <= 0 {
		return "?"
	}
	return strconv.Itoa(n)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
