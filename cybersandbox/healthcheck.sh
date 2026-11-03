#!/bin/sh
set -eu

fail() { echo "unhealthy: $1" >&2; exit 1; }

test -f /tmp/cyberbox-dashboard-ready || fail "dashboard integration pending"
curl -fsS -o /dev/null http://127.0.0.1:8080/index.html || fail "dashboard"
curl -fsS -o /dev/null http://127.0.0.1:8080/terminal || fail "terminal route"
curl -fsS -o /dev/null http://127.0.0.1:8080/jupyter || fail "jupyter route"
curl -fsS -o /dev/null http://127.0.0.1:8080/code-server/ || fail "code-server route"
curl -fsS -o /dev/null http://127.0.0.1:8080/csbx/api/state || fail "plugin center"
curl -fsS -o /dev/null http://127.0.0.1:9222/json/version || fail "chromium CDP"

for service in nginx browser tigervnc websocat python-server code-server jupyter csbx-ui; do
  supervisorctl status "$service" 2>/dev/null | grep -q 'RUNNING' || fail "$service process"
done

for command in csbx prowl nuclei httpx nmap python3; do
  command -v "$command" >/dev/null 2>&1 || fail "$command dependency"
done

echo "healthy: dashboard browser terminal jupyter code-server plugins tools"
