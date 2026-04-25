# Upstream comparison: agent-infra/sandbox vs cybersandbox

**Spec:** [014 — public benchmarking leaderboard](../.auto-claude/specs/014-public-benchmarking-leaderboard/spec.md)
**Phase:** discovery (phase-1)
**Discovery date:** 2026-04-25

## Verdict

```
verdict: compatible
mechanism: ci-matrix
```

Both servers expose the same MCP tool surface for the eval suite to run unmodified. Side-by-side benchmarking is feasible without harness changes.

## Evidence

### CyberSandbox is built on the upstream image

`cybersandbox/Dockerfile` line 11:

```dockerfile
FROM ghcr.io/agent-infra/sandbox@sha256:e0d7cfed...
```

This means the MCP server, tool registry, and `/mcp` HTTP endpoint exposed by CyberSandbox are inherited verbatim from the upstream `agent-infra/sandbox` image. Any tool that exists in CyberSandbox's MCP surface exists in upstream's.

### MCP server URL is already env-driven

`evaluation/main.py:56`:

```python
MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://localhost:8080/mcp")
```

Switching the harness to point at the upstream image requires zero code change — only an env var override. This is the foundation that makes the `ci-matrix` mechanism viable.

### Tool surface used by the eval suite

The five MCP tool names the evaluation harness invokes today (across all `evaluation/dataset/evaluation_*.xml` files):

| Tool | Purpose | Upstream-native |
|------|---------|-----------------|
| `sandbox_get_context` | Retrieve sandbox session context | yes |
| `sandbox_browser_navigate` | Drive the headless browser | yes |
| `sandbox_browser_get_info` | Read DOM / page state | yes |
| `sandbox_browser_evaluate` | Execute JS in the page | yes |
| `sandbox_file_operations` | Read/write files in the sandbox FS | yes |

None of these tools were renamed, removed, or wrapped by CyberSandbox's image-level customization. The cybersandbox layer adds *additional* tooling (the offensive-security toolset — nuclei, subfinder, etc.) but does not subtract from or rename the upstream MCP surface.

## Mechanism choice: `ci-matrix`

Three candidate mechanisms were considered:

| Mechanism | Pros | Cons | Verdict |
|-----------|------|------|---------|
| **subprocess** — local docker run of upstream + secondary `MCP_SERVER_URL` | Easiest local dev loop | Requires Docker on every CI runner; adds startup latency | Use for `evaluation/run_upstream.sh` local-debug helper only |
| **sidecar** — docker-compose with both servers up | Single CI job, minimal env juggling | Couples the two runs (one OOM kills both); compose adds an unrelated dep | Rejected |
| **ci-matrix** — GH Actions matrix with two `MCP_SERVER_URL` values | Independent failure modes; results merged by `config_ref` after both jobs complete; existing GHA pattern | Two jobs to provision instead of one | **Selected** |

**Selected: `mechanism: ci-matrix`** — runs `evaluation/main.py` twice in parallel via a GHA matrix `{target: cyberbox, upstream}`, each pointing `MCP_SERVER_URL` at the appropriate image. JSON sidecars from both runs land in `evaluation/result/<date>/{cybersandbox,upstream}/`, then `evaluation/merge_leaderboard.py` (phase-3) joins them by `config_ref` into the unified leaderboard rows the website reads.

A subprocess-based `evaluation/run_upstream.sh` is still useful for local development (run upstream image, point local main.py at it) but is not the CI execution path.

## What this unblocks

- **Phase 2** (data shape): proceed — the JSON sidecar emitter writes rows that the upstream-runner will populate later.
- **Phase 3** (upstream comparison runner): proceed — the `ci-matrix` mechanism is the implementation target.
- **Phase 5** (refresh workflow): proceed — the GH Actions workflow uses the matrix design above.

## What would change this verdict

If a future cybersandbox release diverges from upstream's MCP surface — e.g., renaming `sandbox_browser_navigate` to `cybersandbox_browser_navigate`, or removing `sandbox_get_context` — re-run this discovery and update the verdict line at the top. The eval harness assumes 1:1 tool-name parity; rename without translation = false-negative pass-rate drop on the upstream column.
