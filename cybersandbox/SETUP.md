# CyberSandbox Setup

Docker-based cybersecurity workspace with 160+ tools, dual AI (Ollama + Claude), Caido proxy, Metasploit, and a plugin marketplace.

## Prerequisites

- Docker + Docker Compose
- 16GB+ RAM recommended (Metasploit + browser + tools)
- ~12GB disk for the image

Optional:
- [Ollama](https://ollama.ai) running on host (for local AI)
- Anthropic API key (for Claude AI)
- GitHub token (for private repos / higher rate limits)

## Quick Start

```bash
cd cybersandbox

# 1. Create your .env from the template
cp .env.example .env
# Edit .env — at minimum set GIT_NAME and GIT_EMAIL

# 2. Build (first build takes 15-20 min)
docker compose build

# 3. Run
docker compose up -d

# 4. Access
# Browser UI:  http://localhost:8082
# VNC:         http://localhost:8082/vnc/index.html?autoconnect=true
# VSCode:      http://localhost:8082/code-server/
# Terminal:    http://localhost:8082 (open terminal in browser)
```

## Configuration

### .env variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GIT_NAME` | yes | Your git commit name |
| `GIT_EMAIL` | yes | Your git email |
| `ANTHROPIC_API_KEY` | no | Claude API key for AI analysis |
| `CLAUDE_MODEL` | no | Default: claude-sonnet-4-20250514 |
| `OLLAMA_HOST` | no | Default: http://host.docker.internal:11434 |
| `OLLAMA_MODEL` | no | Default: llama3.1 |
| `GITHUB_TOKEN` | no | For private repos and rate limits |
| `TZ` | no | Default: America/New_York |

### Volumes

| Mount | Purpose |
|-------|---------|
| `/vault` (ro) | Obsidian vault — read-only reference |
| `/templates` (ro) | Custom nuclei templates |
| `cybersandbox-exports` | Findings export — sync to vault |
| `cybersandbox-workspace` | Persistent home directory |

### Ports

Only `127.0.0.1:8082` is exposed by default (localhost only).

## Tools

### Installed tools (partial list)

**Recon:** subfinder, httpx, katana, dnsx, naabu, chaos, waybackurls, gau, assetfinder, amass, uncover, tlsx, asnmap, cdncheck

**Scanning:** nuclei, dalfox, ffuf, arjun, sqlmap, jwt-hack, crlfuzz, kxss

**Secrets:** trufflehog, gitleaks

**Network:** nmap, mitmproxy, Metasploit (msfconsole)

**AI CLI:** invoke-claude, invoke-ollama

**Pipeline:** harbinger (autonomous hunt orchestrator)

**Plugin manager:** csbx (install community tools/wordlists/templates)

Run `tool-check` or see entrypoint output for the full verified list.

## CLI Tools

### invoke-claude

```bash
echo "analyze this header" | invoke-claude -s "You are a security researcher"
invoke-claude -m opus "What IDOR patterns exist in this API?"
invoke-claude -j "Return JSON analysis"  # JSON mode
```

### invoke-ollama

```bash
echo "triage these subdomains" | invoke-ollama
invoke-ollama -m mistral "Explain this CVE"
invoke-ollama -l  # List available models
```

### harbinger

```bash
harbinger hunt example.com          # Full pipeline: recon → scan → report
harbinger recon example.com         # Recon only
harbinger scan example.com          # Scan only (needs recon first)
harbinger report example.com        # AI-generated report
harbinger status example.com        # Check workspace
```

### csbx (plugin manager)

```bash
csbx sync                           # Update registry
csbx search fuzzing                 # Search plugins
csbx install seclists               # Install from registry
csbx install https://github.com/user/repo  # Install any repo
csbx list                           # Show installed plugins
csbx remove seclists                # Uninstall
csbx doctor                         # Health check
```

## Prowlr Caido Plugin

The Prowlr plugin adds scope enforcement, AI-powered request analysis, and Obsidian export to Caido.

### Install

1. Open Caido
2. Go to Plugins → Install from file
3. Select `caido-plugin/prowlr-0.1.0.zip`

### Features

- **Scope enforcement** — include/exclude patterns for targets
- **AI analysis** — right-click any request → "Analyze with Prowlr"
- **Dual provider** — toggle between Ollama (fast/free) and Claude (deep)
- **Findings** — severity-tagged findings with evidence
- **Obsidian export** — exports findings as markdown to `/home/hunter/exports/findings/`

## Exporting Findings to Obsidian

Findings export writes to the `cybersandbox-exports` volume at `/home/hunter/exports/findings/`. Since the vault is mounted read-only (by design), sync manually:

```bash
# From the host, copy exports into your vault
docker cp cybersandbox:/home/hunter/exports/findings/ \
  "/mnt/c/Users/Dr34d/OneDrive/Documents/Obsidian Vault/04 - Hunt Journal/"

# Or mount the export volume directly
docker run --rm -v cybersandbox-exports:/data -v /your/vault:/vault alpine \
  cp -r /data/findings/ /vault/04\ -\ Hunt\ Journal/
```

## Rebuilding

```bash
docker compose build --no-cache      # Full rebuild
docker compose up -d --build          # Rebuild + restart
docker compose down -v                # Wipe all data (workspace + exports)
```

## Troubleshooting

**Build fails on Go tools:** The Dockerfile uses `GOTOOLCHAIN=auto` to handle version requirements. If a tool's module changes structure, it may need updating.

**MCP config not merging:** The entrypoint tries to merge configs with jq. If `/opt/gem/mcp-hub.json` isn't writable, it falls back to `~/.config/mcp-hub.json`.

**Ollama not connecting:** Make sure Ollama is running on the host and accessible at the configured `OLLAMA_HOST`. The default uses Docker's `host.docker.internal`.

**Out of memory:** The container is limited to 8GB by default. Increase `mem_limit` in docker-compose.yml if running heavy scans + Metasploit simultaneously.
