#!/bin/bash
# CyberSandbox entrypoint overlay
# Runs BEFORE the main sandbox entrypoint

echo "=== CyberSandbox Initializing ==="

# Merge custom MCP config (preserve base, overlay ours)
if [ -f /opt/cybersandbox/mcp-hub-cyber.json ] && [ -f /opt/gem/mcp-hub.json ]; then
    if [ -w /opt/gem/mcp-hub.json ]; then
        jq -s '.[0] * .[1]' /opt/gem/mcp-hub.json /opt/cybersandbox/mcp-hub-cyber.json > /tmp/mcp-merged.json
        cp /tmp/mcp-merged.json /opt/gem/mcp-hub.json
        rm /tmp/mcp-merged.json
        echo "[+] Custom MCP hub config merged"
    else
        echo "[!] MCP hub config not writable — using custom config via symlink"
        mkdir -p /home/hunter/.config
        jq -s '.[0] * .[1]' /opt/gem/mcp-hub.json /opt/cybersandbox/mcp-hub-cyber.json > /home/hunter/.config/mcp-hub.json 2>/dev/null || \
            cp /opt/cybersandbox/mcp-hub-cyber.json /home/hunter/.config/mcp-hub.json
        echo "[+] Custom MCP config at /home/hunter/.config/mcp-hub.json"
    fi
elif [ -f /opt/cybersandbox/mcp-hub-cyber.json ]; then
    cp /opt/cybersandbox/mcp-hub-cyber.json /home/hunter/.config/mcp-hub.json 2>/dev/null || true
    echo "[+] Custom MCP hub config loaded"
fi

# Set up git identity from env vars (not hardcoded)
git config --global user.name "${GIT_NAME:-kdairatchi}"
git config --global user.email "${GIT_EMAIL:-96064915+kdairatchi@users.noreply.github.com}"

# Link Obsidian vault if mounted
if [ -d /vault ]; then
    ln -sf /vault /home/hunter/vault
    echo "[+] Obsidian vault linked at /home/hunter/vault (read-only)"
fi

# Create export directories (writable volume for findings → Obsidian sync)
mkdir -p /home/hunter/exports/findings /home/hunter/exports/reports
echo "[+] Export dir ready at /home/hunter/exports/ (sync to vault)"

# Link nuclei templates if mounted
if [ -d /templates ]; then
    ln -sf /templates /home/hunter/nuclei-templates
    echo "[+] Custom nuclei templates linked"
fi

# Verify key tools
echo "[+] Tool check:"
for tool in nuclei subfinder httpx katana dalfox ffuf nmap crystal jwt-hack trufflehog gitleaks mitmproxy msfconsole harbinger csbx; do
    if command -v "$tool" &>/dev/null; then
        echo "    ✓ $tool"
    else
        echo "    ✗ $tool (missing)"
    fi
done

echo "=== CyberSandbox Ready ==="

# Hand off to original entrypoint
exec /opt/gem/run.sh "$@"
