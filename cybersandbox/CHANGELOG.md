# Changelog

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
