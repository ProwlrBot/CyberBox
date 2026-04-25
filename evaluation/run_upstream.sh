#!/usr/bin/env bash
# evaluation/run_upstream.sh — local-debug helper for spec 014 phase 3.
#
# Boots the upstream agent-infra/sandbox image on a sibling port, runs the
# eval harness against it, then relocates the resulting JSON + Markdown
# sidecars under result/<date>/upstream/ so evaluation/merge_leaderboard.py
# can pair them with cybersandbox sidecars by config_ref.
#
# CI does the same thing via the leaderboard-refresh.yml matrix (phase 5);
# this script is the local-dev equivalent so a hunter can reproduce a
# leaderboard row end-to-end without provisioning GitHub Actions.
#
# Usage:
#   evaluation/run_upstream.sh --config configs/langgraph_ping.toml
#   UPSTREAM_IMAGE=ghcr.io/agent-infra/sandbox@sha256:abc... \
#     evaluation/run_upstream.sh --eval ping --agent langgraph

set -euo pipefail

UPSTREAM_IMAGE="${UPSTREAM_IMAGE:-ghcr.io/agent-infra/sandbox:latest}"
UPSTREAM_PORT="${UPSTREAM_PORT:-8081}"
READY_TIMEOUT="${READY_TIMEOUT:-60}"

HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Sanity: docker must be available.
if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found in PATH (install Docker Desktop or set up a daemon)" >&2
  exit 2
fi

# Sanity: upstream port must be free.
if lsof -i ":${UPSTREAM_PORT}" >/dev/null 2>&1; then
  echo "error: port ${UPSTREAM_PORT} is in use; set UPSTREAM_PORT=<other> and retry" >&2
  exit 2
fi

echo "Booting upstream image: ${UPSTREAM_IMAGE} on :${UPSTREAM_PORT}"
container_id=$(docker run -d --rm -p "${UPSTREAM_PORT}:8080" "$UPSTREAM_IMAGE")
trap 'docker stop "$container_id" >/dev/null 2>&1 || true' EXIT

# Wait for the upstream MCP endpoint. agent-infra/sandbox exposes /mcp as
# a streamable-HTTP endpoint; a HEAD request returns 405 (method not
# allowed) when the server is up — that's the readiness signal.
echo "Waiting up to ${READY_TIMEOUT}s for upstream MCP at http://localhost:${UPSTREAM_PORT}/mcp ..."
ready=0
for ((i=0; i<READY_TIMEOUT; i++)); do
  if curl -sS -o /dev/null -w '%{http_code}' "http://localhost:${UPSTREAM_PORT}/mcp" 2>/dev/null \
       | grep -qE '^(2|3|4)'; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "error: upstream MCP did not become ready within ${READY_TIMEOUT}s" >&2
  docker logs "$container_id" >&2 || true
  exit 3
fi
echo "Upstream MCP ready."

# Run the harness against the upstream MCP. All extra args pass through
# to main.py — pick a config or specify --eval/--agent as you would for
# a normal local run.
export MCP_SERVER_URL="http://localhost:${UPSTREAM_PORT}/mcp"
echo "Running harness against upstream (MCP_SERVER_URL=${MCP_SERVER_URL})"
cd "$HARNESS_DIR"
uv run main.py "$@"

# Relocate today's outputs to result/<date>/upstream/ so the merger can
# pair them with cybersandbox sidecars at the same date+eval_name.
# The harness uses UTC+8 dating; mirror it here.
if date -u -v+8H +%Y%m%d >/dev/null 2>&1; then
  date_str=$(date -u -v+8H +%Y%m%d)            # macOS / BSD date
else
  date_str=$(date -u -d '+8 hours' +%Y%m%d)    # GNU date
fi
result_dir="${HARNESS_DIR}/result/${date_str}"
upstream_dir="${result_dir}/upstream"

if [[ -d "$result_dir" ]]; then
  mkdir -p "$upstream_dir"
  moved=0
  for f in "$result_dir"/*.json "$result_dir"/*.md; do
    # Skip files already under upstream/ or other named subdirs (output_subdir).
    [[ -f "$f" ]] || continue
    mv "$f" "$upstream_dir/"
    moved=$((moved + 1))
  done
  if [[ "$moved" -gt 0 ]]; then
    echo "Moved ${moved} sidecar(s) to ${upstream_dir}"
  else
    echo "warn: no top-level sidecars found in ${result_dir} to move" >&2
    echo "      (if your config sets output_subdir, sidecars landed there;"
    echo "       relocate manually or run the harness without output_subdir)"
  fi
else
  echo "warn: harness did not create ${result_dir} — nothing to relocate" >&2
fi

echo "Done. Pair with cybersandbox via:"
echo "  python3 ${HARNESS_DIR}/merge_leaderboard.py --in ${HARNESS_DIR}/result --out website/data/leaderboard.json"
