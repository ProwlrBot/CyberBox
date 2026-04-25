package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/ProwlrBot/CyberBox/cli/internal/ollama"
)

// invokeOllamaOpts mirrors the bash invoke-ollama flag surface. The
// default model and host are resolved at run-time so env-var changes
// after package init still take effect.
type invokeOllamaOpts struct {
	model     string
	system    string
	jsonMode  bool
	rawOutput bool
	listMode  bool
}

func newInvokeOllamaCmd() *cobra.Command {
	opts := &invokeOllamaOpts{}

	cmd := &cobra.Command{
		Use:   "invoke-ollama [prompt]...",
		Short: "Send prompts to a local Ollama instance",
		Long: `invoke-ollama — Ollama from the terminal (local, private, free).

Reads stdin if connected to a pipe and concatenates it with any prompt args.
Behavioral parity with the legacy bash invoke-ollama script: same flag surface,
same OLLAMA_HOST/OLLAMA_MODEL env-var precedence, same TTY-aware stderr usage
footer.`,
		Example: `  cyberbox invoke-ollama "explain this HTTP response"
  cat response.txt | cyberbox invoke-ollama "find security issues"
  cyberbox invoke-ollama -m deepseek-r1 "complex analysis"
  cyberbox invoke-ollama -l
  nuclei -jsonl -u target.com | cyberbox invoke-ollama "triage these findings"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runInvokeOllama(cmd.Context(), opts, args, os.Stdin, os.Stdout, os.Stderr)
		},
	}

	cmd.Flags().StringVarP(&opts.model, "model", "m", "",
		"Model name (default: $OLLAMA_MODEL or "+ollama.DefaultModel+")")
	cmd.Flags().StringVarP(&opts.system, "system", "s", "",
		"System prompt")
	cmd.Flags().BoolVarP(&opts.jsonMode, "json", "j", false,
		"Request JSON-format output (Ollama format=\"json\")")
	cmd.Flags().BoolVarP(&opts.rawOutput, "raw", "r", false,
		"Raw output: suppress 'thinking…' and token/duration footer on stderr")
	cmd.Flags().BoolVarP(&opts.listMode, "list", "l", false,
		"List models available on the daemon and exit")

	return cmd
}

// runInvokeOllama is the testable core. The cobra wrapper passes real
// os.Std* streams; tests pass bytes.Buffer / bytes.Reader.
func runInvokeOllama(
	ctx context.Context,
	opts *invokeOllamaOpts,
	args []string,
	stdin io.Reader,
	stdout, stderr io.Writer,
) error {
	host := envOrDefault("OLLAMA_HOST", ollama.DefaultEndpoint)
	client := ollama.New(ollama.Config{Endpoint: host})

	// --list short-circuits everything else; matches the bash script.
	if opts.listMode {
		return runOllamaList(ctx, client, host, stdout, stderr)
	}

	model := firstNonEmpty(opts.model, os.Getenv("OLLAMA_MODEL"), ollama.DefaultModel)

	// Connection check before we spend time building the prompt — same
	// UX as the bash script's curl preflight. Distinguishes "daemon
	// down" (clear hint) from "request failed mid-flight" (generic err).
	if err := client.Ping(ctx); err != nil {
		fmt.Fprintf(stderr, "Error: Ollama not running at %s\n", host)
		fmt.Fprintln(stderr, "  Start it: ollama serve")
		fmt.Fprintln(stderr, "  Or set:   export OLLAMA_HOST=http://your-host:11434")
		return fmt.Errorf("ollama unreachable at %s: %w", host, err)
	}

	prompt := buildPrompt(args, stdin)
	if prompt == "" {
		fmt.Fprintln(stderr, `Error: No prompt provided. Use: invoke-ollama "your prompt"`)
		return errors.New("no prompt")
	}

	format := ""
	if opts.jsonMode {
		format = "json"
	}

	if !opts.rawOutput && isTerminal(stderr) {
		dim, reset := colorCodes(stderr)
		fmt.Fprintf(stderr, "%s[ollama:%s] thinking...%s\n", dim, model, reset)
	}

	resp, err := client.Generate(ctx, ollama.Request{
		Model:  model,
		Prompt: prompt,
		System: opts.system,
		Format: format,
	})
	if err != nil {
		fmt.Fprintf(stderr, "Error: %s\n", err)
		return err
	}

	if resp.Response == "" {
		fmt.Fprintln(stderr, "Error: empty response from ollama")
		return errors.New("empty response")
	}

	fmt.Fprintln(stdout, resp.Response)
	if !opts.rawOutput {
		dim, reset := colorCodes(stderr)
		fmt.Fprintf(stderr, "\n%s[tokens: %s | %.1fs | model: %s]%s\n",
			dim,
			ollamaUsageStr(resp.EvalCount),
			resp.DurationSeconds(),
			model, reset,
		)
	}
	return nil
}

// runOllamaList is the --list path. Aligned columns via text/tabwriter
// so readability matches the bash version's `column -t -s $'\t'`.
func runOllamaList(ctx context.Context, client *ollama.Client, host string, stdout, stderr io.Writer) error {
	tags, err := client.ListModels(ctx)
	if err != nil {
		fmt.Fprintf(stderr, "Error: Ollama not running at %s\n", host)
		fmt.Fprintln(stderr, "  Start it: ollama serve")
		return err
	}
	if len(tags.Models) == 0 {
		fmt.Fprintln(stderr, "No models installed. Pull one: ollama pull llama3.1")
		return nil
	}

	tw := tabwriter.NewWriter(stdout, 0, 0, 2, ' ', 0)
	for _, m := range tags.Models {
		// Bash script formatted size as GB with 2dp; replicate that.
		sizeGB := float64(m.Size) / (1024 * 1024 * 1024)
		params := m.Details.ParameterSize
		if params == "" {
			params = "?"
		}
		fmt.Fprintf(tw, "%s\t%.2fGB\t%s\n", m.Name, sizeGB, params)
	}
	return tw.Flush()
}

// ollamaUsageStr — same shape as usageStr from invoke_claude.go, kept
// separate to avoid coupling the two ports' formatting accidentally.
func ollamaUsageStr(n int) string {
	if n <= 0 {
		return "?"
	}
	return strconv.Itoa(n)
}
