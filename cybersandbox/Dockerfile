# syntax=docker/dockerfile:1.7
# ══════════════════════════════════════════════════════════════
# CyberSandbox — pinned by digest/tag for reproducibility.
# Update digests via scripts/refresh-pins.sh (see SECURITY.md).
# ══════════════════════════════════════════════════════════════
FROM ghcr.io/agent-infra/sandbox@sha256:e0d7cfed24b373850f5f3df64439e9fcaa17e6810ab3234222e901a5fa08397e AS base

# ══════════════════════════════════════════════════════════════
# Stage 1: Go tools builder
# ══════════════════════════════════════════════════════════════
# golang 1.25-bookworm — picks up fixed stdlib for CVE-2025-68121 (crypto/tls).
FROM golang@sha256:29e59af995c51a5bf63d072eca973b918e0e7af4db0e4667aa73f1b8da1a6d8c AS go-builder

RUN apt-get update && apt-get install -y --no-install-recommends libpcap-dev && rm -rf /var/lib/apt/lists/*

ENV GOTOOLCHAIN=auto \
    CGO_ENABLED=1

# ProjectDiscovery suite (pinned)
RUN go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@v3.7.1 \
 && go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@v2.13.0 \
 && go install github.com/projectdiscovery/httpx/cmd/httpx@v1.9.0 \
 && go install github.com/projectdiscovery/katana/cmd/katana@v1.5.0 \
 && go install github.com/projectdiscovery/dnsx/cmd/dnsx@v1.2.3 \
 && go install github.com/projectdiscovery/naabu/v2/cmd/naabu@v2.5.0 \
 && go install github.com/projectdiscovery/notify/cmd/notify@v1.0.7 \
 && go install github.com/projectdiscovery/uncover/cmd/uncover@v1.2.0 \
 && go install github.com/projectdiscovery/tlsx/cmd/tlsx@v1.2.2 \
 && go install github.com/projectdiscovery/asnmap/cmd/asnmap@v1.1.1 \
 && go install github.com/projectdiscovery/mapcidr/cmd/mapcidr@v1.1.97 \
 && go install github.com/projectdiscovery/cdncheck/cmd/cdncheck@v1.2.31 \
 && go install github.com/projectdiscovery/alterx/cmd/alterx@v0.1.0 \
 && go install github.com/projectdiscovery/urlfinder/cmd/urlfinder@v0.0.3 \
 && go install github.com/projectdiscovery/chaos-client/cmd/chaos@v0.5.2 \
 && go install github.com/projectdiscovery/interactsh/cmd/interactsh-client@v1.3.1

# Community tools — tomnomnom (pinned)
RUN go install github.com/tomnomnom/waybackurls@v0.1.0 \
 && go install github.com/tomnomnom/gf@dcd4c361f9f5 \
 && go install github.com/tomnomnom/anew@v0.1.1 \
 && go install github.com/tomnomnom/unfurl@v0.4.3 \
 && go install github.com/tomnomnom/qsreplace@v0.0.3 \
 && go install github.com/tomnomnom/httprobe@0745f649beb0

# Community tools — hahwul (pinned)
RUN go install github.com/hahwul/dalfox/v2@v2.12.0 \
 && go install github.com/hahwul/authz0@v1.1.2 \
 && go install github.com/hahwul/gitls@v1.0.4

# Community tools — misc (pinned; gf/jsluice/airixss have no releases → pin by commit)
RUN go install github.com/lc/gau/v2/cmd/gau@v2.2.4 \
 && go install github.com/hakluke/hakrawler@76152559a809 \
 && go install github.com/BishopFox/jsluice/cmd/jsluice@0ddfab153e06 \
 && go install github.com/ferreiraklet/airixss@4c36e01b78fd \
 && go install github.com/dwisiswant0/crlfuzz/cmd/crlfuzz@v1.4.1 \
 && go install github.com/ffuf/ffuf/v2@v2.1.0

# Secrets scanners — gitleaks built from source (inherits pinned Go toolchain
# → picks up stdlib CVE fixes). trufflehog from release tarball (replace
# directives block `go install`).
ARG TRUFFLEHOG_VER=v3.94.3
RUN go install github.com/zricethezav/gitleaks/v8@v8.30.1 \
 && curl -sSfL "https://github.com/trufflesecurity/trufflehog/releases/download/${TRUFFLEHOG_VER}/trufflehog_${TRUFFLEHOG_VER#v}_linux_amd64.tar.gz" \
      | tar -xz -C /go/bin trufflehog

# ══════════════════════════════════════════════════════════════
# Stage 2: Final image
# ══════════════════════════════════════════════════════════════
FROM base

LABEL maintainer="kdairatchi <prowlr@proton.me>" \
      description="CyberSandbox — AI-agent-native cybersecurity workspace" \
      org.opencontainers.image.source="https://github.com/ProwlrBot/CyberBox" \
      org.opencontainers.image.description="CyberSandbox: hardened sandbox for bug-bounty + offensive security research" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="ProwlrBot"

USER root

# ── System deps ──────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl wget unzip jq dnsutils whois nmap \
    libpcap-dev build-essential pkg-config \
    zsh tmux socat netcat-openbsd \
    python3-venv \
    mitmproxy tcpdump tshark \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# ── Copy Go binaries from builder ────────────────────────────
COPY --from=go-builder /go/bin/ /usr/local/bin/

# ── jwt-hack from pinned GitHub release ──────────────────────
# v2.5.0 requires glibc 2.38; base image is glibc 2.35 → pin to v2.3.0.
ARG JWT_HACK_VER=v2.3.0
RUN curl -sSfL "https://github.com/hahwul/jwt-hack/releases/download/${JWT_HACK_VER}/jwt-hack-${JWT_HACK_VER}-linux-x86_64.tar.gz" \
      | tar -xz --strip-components=1 -C /usr/local/bin "jwt-hack-${JWT_HACK_VER}-linux-x86_64/jwt-hack" \
 && chmod +x /usr/local/bin/jwt-hack

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

EXPOSE 8080

# ── Healthcheck: verify core CLIs resolve ───────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD command -v nuclei >/dev/null \
   && command -v harbinger >/dev/null \
   && command -v csbx >/dev/null \
   || exit 1

# ── Use entrypoint overlay ──────────────────────────────────
ENTRYPOINT ["/opt/cybersandbox/entrypoint-cyber.sh"]
