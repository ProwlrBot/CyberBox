# cyberbox

Single Go binary replacing the legacy bash CLIs (`csbx`, `harbinger`,
`invoke-claude`, `invoke-ollama`). Implements [spec 018](../.auto-claude/specs/018-single-go-binary-for-csbx-harbinger-invoke-cli/spec.md)
incrementally — each subcommand is ported in its own PR, with the bash
files becoming thin shims once a Go implementation exists.

## Status

| Subcommand | Status | Notes |
|------------|--------|-------|
| `cyberbox invoke-claude` | ✅ Ported (Phase 1) | Behavioral parity with `harbinger/bin/invoke-claude` |
| `cyberbox invoke-ollama` | ✅ Ported (Phase 2) | Behavioral parity with `harbinger/bin/invoke-ollama`; supports `-m/-s/-j/-r/-l` flags + OLLAMA_HOST/OLLAMA_MODEL env precedence |
| `cyberbox csbx` | 🟡 Stub | Prints redirect to bash file |
| `cyberbox harbinger` | 🟡 Stub | Prints redirect to bash file |

Stubs exit with code **2** so callers can distinguish "not yet ported"
from generic operation failures (exit 1).

## Why

- **Native Windows support** — Burp and Caido work natively on Windows
  today; bash-first CLI excludes anyone without WSL2.
- **Single test stack** — one `go test ./...` instead of separate bash
  test runners per binary.
- **Reproducible distribution** — cross-compiled, cosign-signed via the
  existing supply-chain workflow (see [`/website/docs/en/guide/trust.mdx`](../website/docs/en/guide/trust.mdx)).

## Build & test

```bash
cd cli
make build        # build ./dist/cyberbox for the host platform
make test         # go test -race -count=1 ./...
make vet          # go vet ./...
make cross        # smoke-build for all 5 release targets
make install      # go install into $GOPATH/bin
```

## Use it (Phases 1 + 2)

```bash
# invoke-claude (Phase 1) — needs ANTHROPIC_API_KEY or CLAUDE_API_KEY
export ANTHROPIC_API_KEY=sk-ant-...
./dist/cyberbox invoke-claude "explain this vuln"
cat finding.txt | ./dist/cyberbox invoke-claude "summarise"
./dist/cyberbox invoke-claude -m opus -s "You are a pentest expert" "review this"
curl -s target.com | ./dist/cyberbox invoke-claude -j "extract endpoints"

# invoke-ollama (Phase 2) — needs a local Ollama daemon (`ollama serve`)
./dist/cyberbox invoke-ollama "explain this HTTP response"
cat response.txt | ./dist/cyberbox invoke-ollama "find security issues"
./dist/cyberbox invoke-ollama -m deepseek-r1 "complex analysis"
./dist/cyberbox invoke-ollama -l                            # list installed models
nuclei -jsonl -u target.com | ./dist/cyberbox invoke-ollama "triage these findings"
```

Flag parity with the bash scripts:

- **invoke-claude**: `-m/--model`, `-s/--system`, `-t/--tokens`, `-j/--json`, `-r/--raw`, `-h/--help`. Model aliases (`sonnet`/`opus`/`haiku`) + `ANTHROPIC_API_KEY`/`CLAUDE_API_KEY` env-var precedence preserved.
- **invoke-ollama**: `-m/--model`, `-s/--system`, `-j/--json`, `-r/--raw`, `-l/--list`, `-h/--help`. `OLLAMA_HOST`/`OLLAMA_MODEL` env-var precedence preserved (flag > env > default `llama3.1`).

## Migration plan

The bash files in `harbinger/bin/` continue to work unchanged today. Once
each subcommand has a stable Go port:

1. Cut a `cyberbox` release via GoReleaser (cross-compiled, cosign-signed,
   SBOM attached).
2. Replace the corresponding bash file with a one-liner shim:

   ```bash
   #!/usr/bin/env bash
   exec "$(dirname "$0")/cyberbox" invoke-claude "$@"
   ```

   Test scripts that invoke the bash file directly (e.g. `harbinger/tests/test_csbx.sh`)
   keep working without modification.
3. After two releases of shim-only behaviour, remove the bash files.

The order of ports is driven by:

1. **invoke-claude** (this PR) — smallest surface (161 bash lines), stateless,
   easiest to test from Go.
2. **invoke-ollama** — same shape as invoke-claude, swap endpoint and
   schema. Shares HTTP client patterns.
3. **csbx** — biggest user-facing surface (946 bash lines, many
   subcommands). Needs YAML/registry parsing, plugin install hooks.
4. **harbinger** — most complex (683 bash lines plus Python helpers and
   phase orchestration). Last because it depends on the above three.

## Layout

```
cli/
├── main.go                          # tiny entrypoint
├── cmd/
│   ├── root.go                      # cobra root + version
│   ├── invoke_claude.go             # Phase 1: Anthropic Messages API
│   ├── invoke_claude_test.go        # table-driven tests via httptest
│   ├── invoke_ollama.go             # Phase 2: local Ollama daemon
│   ├── invoke_ollama_test.go        # table-driven tests via httptest
│   └── stubs.go                     # csbx/harbinger redirect stubs (Phase 3+)
├── internal/
│   ├── anthropic/
│   │   ├── client.go                # minimal Messages API client
│   │   └── client_test.go
│   └── ollama/
│       ├── client.go                # minimal /api/generate + /api/tags client
│       └── client_test.go
├── Makefile
├── .goreleaser.yaml                 # cosign-signed, SBOM-attached release config
├── go.mod / go.sum
└── README.md                        # this file
```

## Testing strategy

- **No live API calls in tests.** The Anthropic client is exercised against
  `httptest.Server` so tests stay deterministic and offline.
- **`runInvokeClaude`** is split out from the cobra wrapper so tests can
  pass `bytes.Buffer` for stdout/stderr and `strings.Reader` for stdin —
  no `os.Pipe` plumbing or t.Setenv with real fds.
- **TTY detection** uses `golang.org/x/term`; `bytes.Buffer` and
  `strings.Reader` are not `*os.File`, so `isTerminal` always returns
  false in tests, matching the "treat tests as non-interactive" policy.

## Compat contract

Spec 018 acceptance criterion: *Existing bash test suite passes unchanged
against the new binary.* Once a subcommand is ported, its bash test
suite (`harbinger/tests/test_<name>.sh`) is the regression baseline. PRs
that swap a bash file for a shim must show the same test green.

`invoke-claude` does not currently have a bash test (the existing tests
cover csbx, harbinger, and pattern files). Phase-1 tests live in Go;
adding a bash compat test in `harbinger/tests/test_invoke_claude.sh`
when the bash file becomes a shim is a planned follow-up.
