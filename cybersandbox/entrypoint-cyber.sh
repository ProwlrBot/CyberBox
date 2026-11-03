#!/bin/bash
# CyberSandbox entrypoint overlay
# Runs BEFORE the main sandbox entrypoint

echo "=== CyberSandbox Initializing ==="

sh /opt/cybersandbox/workspace-migrate.sh

# The browser profile lives on the persistent workspace volume. Chromium's
# singleton files contain a container hostname and survive a container
# replacement, causing Chrome to exit with status 21 on the next start even
# though no browser process exists. The base supervisor has not started yet,
# so these files are always stale at this point.
find /home/hunter/.config/browser -maxdepth 1 -name 'Singleton*' -delete 2>/dev/null || true
echo "[+] Browser profile locks cleared"

# The base entrypoint generates /opt/aio/index.html after this overlay hands
# off. Patch it once it appears, then reload Nginx if it is already ready.
# The helper is idempotent, so this is safe for both fresh and reused images.
(
  for _ in $(seq 1 60); do
    if [ -f /opt/aio/index.html ]; then
      /opt/venv/bin/python /opt/cybersandbox/plugin-center/integrate_dashboard.py 2>/dev/null || exit 0
      echo "[+] CSBX Plugin Center registered"
      for _ in $(seq 1 30); do
        if [ -f /var/run/nginx.pid ]; then
          nginx -c /opt/gem/nginx.conf -s reload 2>/dev/null || true
          break
        fi
        sleep 1
      done
      for _ in $(seq 1 30); do
        if curl -fsS -o /dev/null http://127.0.0.1:8080/index.html &&
           curl -fsS -o /dev/null http://127.0.0.1:8080/csbx/api/health; then
          touch /tmp/cyberbox-dashboard-ready
          break
        fi
        sleep 1
      done
      exit 0
    fi
    sleep 1
  done
  echo "[!] CSBX Plugin Center dashboard integration skipped"
) &

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
  rm -rf /home/hunter/vault 2>/dev/null || true
  ln -sf /vault /home/hunter/vault
  echo "[+] Obsidian vault linked at /home/hunter/vault (read-only)"
fi

# Create export directories (writable volume for findings → Obsidian sync)
mkdir -p /home/hunter/exports/findings /home/hunter/exports/reports
echo "[+] Export dir ready at /home/hunter/exports/ (sync to vault)"

# Link nuclei templates if mounted
if [ -d /templates ]; then
  rm -rf /home/hunter/nuclei-templates-custom 2>/dev/null || true
  ln -sf /templates /home/hunter/nuclei-templates-custom
  echo "[+] Custom nuclei templates linked at /home/hunter/nuclei-templates-custom"
fi

# Verify key tools
echo "[+] Tool check:"
for tool in nuclei subfinder httpx katana dalfox ffuf nmap crystal jwt-hack trufflehog gitleaks mitmproxy msfconsole prowl csbx; do
    if command -v "$tool" &>/dev/null; then
        echo "    ✓ $tool"
    else
        echo "    ✗ $tool (missing)"
    fi
done

echo "=== CyberSandbox Ready ==="

# Hand off to original entrypoint
exec /opt/gem/run.sh "$@"
