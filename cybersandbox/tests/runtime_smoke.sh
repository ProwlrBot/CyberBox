#!/bin/sh
set -eu

image="${1:-cybersandbox:ci}"
name="cyberbox-smoke-$$"
profile_dir="$(mktemp -d)"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$profile_dir"
}
trap cleanup EXIT INT TERM

component_state() {
  component="$1"
  docker exec "$name" sh -c \
    "curl -fsS http://127.0.0.1:8080/csbx/api/health | jq -r '.components[] | select(.id == \"$component\") | .state'"
}

wait_for_runtime_health() {
  label="$1"
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if docker exec "$name" /opt/cybersandbox/healthcheck.sh >/dev/null 2>&1; then
      echo "recovered: $label"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  docker exec "$name" supervisorctl status || true
  echo "CyberBox did not recover after $label" >&2
  return 1
}

# Simulate a profile restored from another container. Chromium refuses to
# start when these hostname-bearing singleton files survive replacement.
for lock in SingletonCookie SingletonLock SingletonSocket; do
  printf '%s\n' cyberbox-stale-lock > "$profile_dir/$lock"
done

docker run -d --name "$name" \
  --user 0:0 \
  --env USER=hunter \
  --env USER_UID=1000 \
  --env USER_GID=1000 \
  --env WORKSPACE=/home/hunter \
  --init \
  --pids-limit 2048 \
  --security-opt no-new-privileges:true \
  --publish 127.0.0.1::8080 \
  --mount "type=bind,src=$profile_dir,dst=/home/hunter/.config/browser" \
  "$image" >/dev/null

attempt=0
while [ "$attempt" -lt 60 ]; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$name")"
  [ "$status" = healthy ] && break
  if [ "$status" = unhealthy ] || [ "$(docker inspect --format '{{.State.Status}}' "$name")" = exited ]; then
    docker logs "$name"
    echo "CyberBox failed runtime smoke test: $status" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ $((attempt % 10)) -eq 0 ]; then
    echo "waiting for CyberBox health: ${attempt}/60 attempts (state: $status)"
  fi
  sleep 2
done

[ "${status:-missing}" = healthy ] || {
  docker logs "$name"
  echo "CyberBox did not become healthy" >&2
  exit 1
}

docker exec "$name" /opt/cybersandbox/healthcheck.sh
docker exec "$name" curl -fsS http://127.0.0.1:8080/csbx/api/health |
  grep -q '"state": "Ready"'
docker exec "$name" grep -q 'data-panel="csbx"' /opt/aio/index.html
docker exec "$name" test -f /home/hunter/.cyberbox/migrations/001-workspace-layout
docker exec "$name" test -d /home/hunter/exports/evidence

if [ "${CYBERBOX_BROWSER_SMOKE:-0}" = 1 ]; then
  published="$(docker port "$name" 8080/tcp | head -n 1)"
  node cybersandbox/tests/dashboard_smoke.mjs "http://$published/"
fi

if find "$profile_dir" -maxdepth 1 -type f -name 'Singleton*' \
    -exec grep -l '^cyberbox-stale-lock$' {} + | grep -q .; then
  echo "marked stale Chromium singleton files survived startup" >&2
  exit 1
fi

# Exercise actual backend lifecycle recovery. The terminal HTML can remain
# reachable while its session backend is down, so component health must also
# be tied to python-server rather than only the static route.
for lifecycle in "terminal:python-server" "jupyter:jupyter"; do
  component="${lifecycle%%:*}"
  process="${lifecycle#*:}"
  docker exec "$name" supervisorctl stop "$process" >/dev/null
  [ "$(component_state "$component")" = Unavailable ] || {
    echo "$component did not report Unavailable after $process stopped" >&2
    exit 1
  }
  docker exec "$name" supervisorctl start "$process" >/dev/null
  wait_for_runtime_health "$component lifecycle"
done

echo "runtime smoke passed: routes, health, dashboard integration, browser/terminal/jupyter recovery"
