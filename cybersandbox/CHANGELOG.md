# Changelog

## Unreleased

### Browser Hunt

- Added two separate browser sessions for authorized testing: attacker and victim. Each session has its own profile, network, credential, and saved sign-in state.
- Added a broker that gives terminal agents a small, logged browser API instead of direct browser-debugging access. Claude, Ollama, Hermes, and other clients can share the same contract without sharing a session.
- Added the Browser Hunt control room to the CyberBox UI. It shows both sessions, human/agent control, pending approvals, scope, recent activity, and provider controls in one place.
- Sign-in stays human-assisted. A short-lived takeover link opens the selected browser, and the resulting browser state can be saved and restored without placing credentials in a prompt.
- Evidence redaction is now a visible policy with three choices: `Always`, `Evidence only`, and `Off`. Operator tokens, cookies, passwords, and broker credentials remain hidden in every mode.
- Added an optional NVIDIA OpenShell policy that limits sandbox agents to the broker's health, contract, and action endpoints.

### Operations

- `./bin/cyberbox browser-hunt start` now starts the two browsers and their broker together.
- The main control plane can reach the local broker through an operator-only proxy; the operator token never reaches the browser UI.
- Browser actions use short leases, exact-action approvals, scope checks, and an append-only local activity log.

### CSBX and Plugin Center

- Brought the client up to the current registry contract: version and policy validation, named PDTM tools, all three catalog sections, and install-plan output.
- Added strict signed-release handling for Caido plugins. CSBX verifies cosign or minisign sidecars, rejects unsafe archives, and only then activates the plugin.
- Standard installs now record the resolved Git commit, preserve registry pins during updates, refuse dirty checkouts, and roll back failed hooks or activation steps.
- Install records are written atomically and mutating commands share a lock, preventing concurrent installs from corrupting `installed.yaml`.
- Plugin Center now labels signatures as requirements until verification has actually happened and shows the resolved registry plan before handing a command to Terminal.
- The image now uses the canonical scripts from `prowl/bin` and includes the verification tools required by strict-tier installs.

### ScopeDeck

- Added ScopeDeck, a local SQLite catalog for program, policy, scope, signal, and change data. It provides search, weighted target draws, JSON export, a loopback web UI, and a small REST API.
- Fixed the initial persistence path so migrations run, syncs retain stable source and program IDs, detail records are stored, and repeat imports are idempotent.
- Remote imports require HTTPS, reject private or reserved destinations, cap response sizes, and limit redirects. Local imports must be regular files.

## 0.2.3 — 2026-04-17

Release hygiene: sprint2 supply-chain follow-ups.

### Added
- **Cosign image signing + independent verify job** in `cybersandbox-build.yml`. Every pushed tag is signed by digest via cosign keyless (Fulcio/Rekor). A separate `verify-supply-chain` job re-pulls the image, validates the signature against this workflow's OIDC identity, and asserts the published SBOM is non-empty.
- **Dependabot config** (`.github/dependabot.yml`) for github-actions (daily), cybersandbox docker base (weekly), and both SDKs (npm + pip, weekly). Timezone `America/Chicago`, grouped updates for docker/*, sigstore/*, actions/*, and security vendors. `open-pull-requests-limit` caps per ecosystem, commit prefixes unified under `deps`.
- **`# revisit: YYYY-MM-DD` annotations** on every entry in `cybersandbox/.trivyignore` — forces a quarterly re-audit instead of silent rot.

### Changed
- **Bumped `sigstore/cosign-installer` SHA pin to v3.9.2** (`d58896d6…`) from v3.7.0.

## 0.2.2 — 2026-04-17

Supply-chain hardening patch. Reproducible builds, pinned toolchain, CI gates, CVE response.

### Fixed
- **jwt-hack now actually ships** — was silently missing from v0.2.1 because the cargo stage was broken.
- **Every Go tool pinned by tag or commit SHA** — replaced `@latest` across the board for reproducible builds.
- **Base image pinned by sha256 digest** — no more mutable tag drift.

### Changed
- **go-builder bumped 1.23 → 1.25** — addresses stdlib CVE-2025-68121.

### Added
- **Trivy CRITICAL gate in CI** — build fails on any CRITICAL CVE.
- **Smoke test at build time** — verifies 13 core binaries are present and executable.
- **HEALTHCHECK directive** in the Dockerfile.

### Security
- **SHA-pinned all GitHub Actions** across workflows, capped job timeouts.
- **Fixed 2× GHA004 run-injection** in `sdk-publish.yml`.

## 0.2.1 — 2026-04-12

Security hardening pass + customization. No more hardcoded values anywhere — 15+ settings exposed in the Prowlr UI, env vars for every CLI knob.

### Added
- **NemoClaw-style guardrails** on Prowlr AI calls: 7 prompt-injection patterns filtered from captured traffic, 6 secret classes redacted from AI output (Anthropic/OpenAI/AWS/GitHub keys, JWTs). Toggle via `guardrails_enabled` setting.
- **AI rate limiter** — per-provider sliding window, `ai_rate_limit_per_min` setting (default 20).
- **Fabric-style pattern library** — `prowl pattern <name>` with 4 seed prompts (analyze_vulns, extract_endpoints, triage_nuclei, write_report).
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
- `prowl` autonomous hunting pipeline (recon → scan → report)
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
