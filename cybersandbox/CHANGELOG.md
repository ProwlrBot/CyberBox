# Changelog

## 0.2.1 — 2026-04-12

Security hardening pass + customization. No more hardcoded values anywhere — 15+ settings exposed in the Prowlr UI, env vars for every CLI knob.

### Added
- **NemoClaw-style guardrails** on Prowlr AI calls: 7 prompt-injection patterns filtered from captured traffic, 6 secret classes redacted from AI output (Anthropic/OpenAI/AWS/GitHub keys, JWTs). Toggle via `guardrails_enabled` setting.
- **AI rate limiter** — per-provider sliding window, `ai_rate_limit_per_min` setting (default 20).
- **Fabric-style pattern library** — `harbinger pattern <name>` with 4 seed prompts (analyze_vulns, extract_endpoints, triage_nuclei, write_report).
- **pdtm-format install** — `csbx pdtm <manifest|go-path>` installs Go tools matching projectdiscovery/pdtm manifest shape. Registry now ships 8 pdtm tool entries.
- **SecLists wordlists volume** — `/wordlists` mount + `seed-wordlists.sh` helper (curated 13-file subset or `FULL=1` for complete SecLists).
- **Embedded xterm.js terminal** tab in the Prowlr Caido plugin.
- **CI workflow** publishes SBOM + provenance attestation, tags semver + sha.
- **Fully customizable settings** — Claude model/endpoint/max_tokens/api_version, Ollama endpoint/model, terminal timeout/cwd, export path, AI analysis prompt, quick commands.

### Fixed
- **CRIT**: command injection via `execSync` in Obsidian export → `fs.writeFileSync` with sanitized filenames.
- **CRIT**: SSRF via Claude/Ollama endpoint settings → `validateEndpoint()` allowlist.
- **CRIT**: Python shell injection in csbx (11 `python3 -c` blocks) → env-var + heredoc pattern.
- **HIGH**: XSS via innerHTML in findings/scope lists → `textContent` DOM construction.
- **HIGH**: ReDoS in scope matcher → escaped patterns + bounded quantifiers.
- **HIGH**: broken scope check passing placeholder URL → real URL from `req.getUrl()`.
- **HIGH**: `saveSettings` couldn't clear fields → removed guard.
- **HIGH**: API key leakage in error messages → `sanitizeError()` redacts `sk-ant-*`.
- **MED**: csbx install hooks auto-executed → `confirm_hook()` with `CSBX_YES=1` bypass.
- **MED**: csbx registry_sync predictable tempfile → `mktemp`.

### Changed
- All bash scripts respect `NO_COLOR` env.
- `target.json` generated via `jq` (no shell quoting bugs).
- AI output always schema-validated before surfacing to UI.
- 16 bash tests covering csbx + harbinger (all passing).

### Docs
- `SETUP.md`, `SECURITY.md`, `SETUP.md` in cybersandbox/
- Vault: `CyberSandbox Hardening Log`, `Local Tools Security Audit`, `Integration Plan`, `Claude Code Agents Library`

### Plugin
- Prowlr v0.2.1 zip (86 KB) attached to release.

## 0.1.0 — 2026-04-12

Initial release of CyberSandbox.

### Added
- Multi-stage Docker build (Go + Rust + final image, ~11.4GB)
- 160+ security tools: ProjectDiscovery suite, dalfox, ffuf, nmap, sqlmap, Metasploit, and more
- Dual AI backend: Ollama (local) + Claude (API) with tiered routing
- `invoke-claude` and `invoke-ollama` CLI wrappers
- `harbinger` autonomous hunting pipeline (recon → scan → report)
- `csbx` plugin manager with community registry at ProwlrBot/csbx-registry
- Prowlr Caido plugin (scope enforcement, AI analysis, Obsidian export)
- MCP hub config merging via entrypoint
- Oh My Zsh with powerlevel10k theme

### Security
- Non-root container (USER 1000)
- Removed seccomp:unconfined — uses targeted cap_add (NET_RAW, NET_ADMIN)
- Ports bound to 127.0.0.1 only
- Obsidian vault mounted read-only
- Tokens via .env file (gitignored), not hardcoded
- Writable export volume for findings (separate from vault)
