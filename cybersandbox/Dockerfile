FROM ghcr.io/agent-infra/sandbox:latest AS base

# ══════════════════════════════════════════════════════════════
# Stage 1: Go tools builder
# ══════════════════════════════════════════════════════════════
FROM golang:1-bookworm AS go-builder

# naabu needs libpcap-dev to compile
RUN apt-get update && apt-get install -y --no-install-recommends libpcap-dev && rm -rf /var/lib/apt/lists/*

# Allow Go to auto-download newer toolchain if deps require it
ENV GOTOOLCHAIN=auto

# ProjectDiscovery suite
RUN go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest \
 && go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest \
 && go install github.com/projectdiscovery/httpx/cmd/httpx@latest \
 && go install github.com/projectdiscovery/katana/cmd/katana@latest \
 && go install github.com/projectdiscovery/dnsx/cmd/dnsx@latest \
 && go install github.com/projectdiscovery/naabu/v2/cmd/naabu@latest \
 && go install github.com/projectdiscovery/notify/cmd/notify@latest \
 && go install github.com/projectdiscovery/uncover/cmd/uncover@latest \
 && go install github.com/projectdiscovery/tlsx/cmd/tlsx@latest \
 && go install github.com/projectdiscovery/asnmap/cmd/asnmap@latest \
 && go install github.com/projectdiscovery/mapcidr/cmd/mapcidr@latest \
 && go install github.com/projectdiscovery/cdncheck/cmd/cdncheck@latest \
 && go install github.com/projectdiscovery/alterx/cmd/alterx@latest \
 && go install github.com/projectdiscovery/urlfinder/cmd/urlfinder@latest \
 && go install github.com/projectdiscovery/chaos-client/cmd/chaos@latest \
 && go install github.com/projectdiscovery/interactsh/cmd/interactsh-client@latest

# Community Go tools (each in own command so one failure doesn't block all)
RUN go install github.com/tomnomnom/waybackurls@latest \
 && go install github.com/tomnomnom/gf@latest \
 && go install github.com/tomnomnom/anew@latest \
 && go install github.com/tomnomnom/unfurl@latest \
 && go install github.com/tomnomnom/qsreplace@latest \
 && go install github.com/tomnomnom/httprobe@latest

RUN go install github.com/hahwul/dalfox/v2@latest \
 && go install github.com/hahwul/authz0@latest \
 && go install github.com/hahwul/gitls@latest

RUN go install github.com/lc/gau/v2/cmd/gau@latest \
 && go install github.com/hakluke/hakrawler@latest \
 && go install github.com/BishopFox/jsluice/cmd/jsluice@latest \
 && go install github.com/ferreiraklet/airixss@latest \
 && go install github.com/dwisiswant0/crlfuzz/cmd/crlfuzz@latest \
 && go install github.com/ffuf/ffuf/v2@latest

# Secrets scanners (installed from release binaries — trufflehog has replace directives blocking go install)
RUN curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh -s -- -b /go/bin
RUN GITLEAKS_VER=$(curl -s https://api.github.com/repos/gitleaks/gitleaks/releases/latest | grep tag_name | cut -d '"' -f4) \
 && curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/${GITLEAKS_VER}/gitleaks_${GITLEAKS_VER#v}_linux_x64.tar.gz" \
    | tar -xz -C /go/bin gitleaks

# ══════════════════════════════════════════════════════════════
# Stage 2: Rust tools builder
# ══════════════════════════════════════════════════════════════
FROM rust:1-bookworm AS rust-builder

RUN cargo install jwt-hack 2>/dev/null || echo "WARN: jwt-hack failed to compile, skipping"

# ══════════════════════════════════════════════════════════════
# Stage 3: Final image
# ══════════════════════════════════════════════════════════════
FROM base

LABEL maintainer="kdairatchi <prowlr@proton.me>"
LABEL description="CyberSandbox — AI-agent-native cybersecurity workspace"

USER root

# ── System deps ──────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl wget unzip jq dnsutils whois nmap \
    libpcap-dev build-essential pkg-config \
    zsh tmux socat netcat-openbsd \
    python3-venv \
    mitmproxy tcpdump tshark \
    && rm -rf /var/lib/apt/lists/*

# ── Copy Go binaries from builder ────────────────────────────
COPY --from=go-builder /go/bin/ /usr/local/bin/

# ── Copy Rust binaries from builder ──────────────────────────
COPY --from=rust-builder /usr/local/cargo/bin/jwt-hack /usr/local/bin/jwt-hack

# ── Metasploit Framework ─────────────────────────────────────
RUN curl -fsSL https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb \
    -o /tmp/msfinstall && chmod +x /tmp/msfinstall && /tmp/msfinstall && rm /tmp/msfinstall

# ── Crystal language (apt repo with GPG verification) ────────
RUN curl -fsSL https://packagecloud.io/84codes/crystal/gpgkey | gpg --dearmor -o /usr/share/keyrings/crystal.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/crystal.gpg] https://packagecloud.io/84codes/crystal/any/ any main" \
    > /etc/apt/sources.list.d/crystal.list \
 && apt-get update && apt-get install -y crystal \
 && rm -rf /var/lib/apt/lists/*

# ── Python security tools (in venv) ─────────────────────────
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir \
    arjun wafw00f commix sqlmap \
    shodan censys \
    requests beautifulsoup4 \
    rich typer click
ENV PATH="/opt/venv/bin:${PATH}"

# ── Nuclei templates ────────────────────────────────────────
RUN nuclei -update-templates 2>/dev/null || true

# ── Claude Code ──────────────────────────────────────────────
RUN npm install -g @anthropic-ai/claude-code

# ── Oh My Zsh ───────────────────────────────────────────────
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended || true

# ── Harbinger CLI (invoke-claude, invoke-ollama, harbinger) ──
COPY harbinger-bin/ /usr/local/bin/
RUN chmod +x /usr/local/bin/invoke-claude /usr/local/bin/invoke-ollama /usr/local/bin/harbinger /usr/local/bin/csbx

# ── Custom MCP hub config ───────────────────────────────────
COPY mcp-hub-cyber.json /opt/cybersandbox/mcp-hub-cyber.json

# ── Make MCP hub config writable by non-root ────────────────
RUN chmod 666 /opt/gem/mcp-hub.json 2>/dev/null || true

# ── Entrypoint overlay ──────────────────────────────────────
COPY entrypoint-cyber.sh /opt/cybersandbox/entrypoint-cyber.sh
RUN chmod +x /opt/cybersandbox/entrypoint-cyber.sh

# ── Create non-root user ────────────────────────────────────
RUN useradd -m -u 1000 -s /bin/zsh -d /home/hunter hunter 2>/dev/null || true; \
    mkdir -p /home/hunter && chown -R 1000:1000 /home/hunter

# ── Workspace setup ─────────────────────────────────────────
ENV WORKSPACE="/home/hunter"

# ── Drop to non-root (use UID to avoid passwd lookup issues) ─
USER 1000

LABEL org.opencontainers.image.source="https://github.com/kdairatchi/cybersandbox"
LABEL org.opencontainers.image.description="CyberSandbox: AI-agent-native cybersecurity workspace"

EXPOSE 8080

# ── Use entrypoint overlay (was never called before — fixed) ─
ENTRYPOINT ["/opt/cybersandbox/entrypoint-cyber.sh"]
