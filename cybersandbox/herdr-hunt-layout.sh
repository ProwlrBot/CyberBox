#!/usr/bin/env bash
# CyberBox hunt workspace layout for Herdr
#
# Sets up a 4-pane workspace:
#   ┌─────────────────────┬──────────────────┐
#   │                     │  Hunt Dashboard  │
#   │   Agent / Hunt      │  (port 9999)     │
#   │   Terminal          ├──────────────────┤
#   │   (main pane)       │  Execution Log   │
#   │                     │  (watch/curl)    │
#   └─────────────────────┴──────────────────┘
#
# Usage:
#   bash herdr-hunt-layout.sh [--dry-run] [--api-port 8080]
#
# Requirements: herdr in PATH, CyberBox platform backend running

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CYBERBOX_DIR="$(dirname "$SCRIPT_DIR")"
STATIC_DIR="$CYBERBOX_DIR/platform/backend/cyberbox/static"

API_PORT=8080
DASHBOARD_PORT=9999
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --api-port=*) API_PORT="${arg#*=}" ;;
  esac
done

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

echo "╔══════════════════════════════════════╗"
echo "║   CyberBox Hunt Layout — Herdr       ║"
echo "╚══════════════════════════════════════╝"

# --- Get current (main agent) pane ---
MAIN_PANE_RAW=$(herdr pane current 2>/dev/null) || { echo "ERROR: herdr not running or no active session."; exit 1; }
# Output may be JSON {"id":"..."} or plain ID
if echo "$MAIN_PANE_RAW" | grep -q '"id"'; then
  MAIN_PANE=$(echo "$MAIN_PANE_RAW" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
else
  MAIN_PANE=$(echo "$MAIN_PANE_RAW" | tr -d '[:space:]')
fi

echo "→ Main pane: $MAIN_PANE"

# --- Split right 40% → Dashboard pane ---
echo "→ Splitting right 40% (dashboard)…"
if [[ $DRY_RUN -eq 0 ]]; then
  DASH_PANE_RAW=$(herdr pane split "$MAIN_PANE" --direction right --ratio 0.4 2>&1)
  if echo "$DASH_PANE_RAW" | grep -q '"id"'; then
    DASH_PANE=$(echo "$DASH_PANE_RAW" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  else
    DASH_PANE=$(echo "$DASH_PANE_RAW" | tr -d '[:space:]')
  fi
  echo "  → Dashboard pane: $DASH_PANE"
else
  DASH_PANE="<dash-pane>"
  run herdr pane split "$MAIN_PANE" --direction right --ratio 0.4
fi

# --- Split dashboard pane down 50% → Exec log pane ---
echo "→ Splitting dashboard pane down 50% (exec log)…"
if [[ $DRY_RUN -eq 0 ]]; then
  EXEC_PANE_RAW=$(herdr pane split "$DASH_PANE" --direction down --ratio 0.5 2>&1)
  if echo "$EXEC_PANE_RAW" | grep -q '"id"'; then
    EXEC_PANE=$(echo "$EXEC_PANE_RAW" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  else
    EXEC_PANE=$(echo "$EXEC_PANE_RAW" | tr -d '[:space:]')
  fi
  echo "  → Exec log pane: $EXEC_PANE"
else
  EXEC_PANE="<exec-pane>"
  run herdr pane split "$DASH_PANE" --direction down --ratio 0.5
fi

# --- Rename panes ---
echo "→ Renaming panes…"
run herdr pane rename "$MAIN_PANE" "Hunt Agent"
run herdr pane rename "$DASH_PANE" "Dashboard"
run herdr pane rename "$EXEC_PANE" "Exec Log"

# --- Start dashboard HTTP server in Dashboard pane ---
echo "→ Starting dashboard server on :$DASHBOARD_PORT…"
DASHBOARD_CMD="cd '$STATIC_DIR' && python3 -m http.server $DASHBOARD_PORT --bind 127.0.0.1"
run herdr pane run "$DASH_PANE" bash -c "$DASHBOARD_CMD"

# Short pause to let server start, then open in browser if xdg-open available
if [[ $DRY_RUN -eq 0 ]]; then
  sleep 1
  (xdg-open "http://localhost:$DASHBOARD_PORT/hunt_dashboard.html" 2>/dev/null || true) &
fi

# --- Start execution log watcher in Exec pane ---
echo "→ Starting execution log watcher…"
EXEC_CMD="while true; do echo '── executions ──'; curl -s http://localhost:$API_PORT/api/v1/executions 2>/dev/null | python3 -m json.tool 2>/dev/null | tail -40 || echo '(api not ready)'; sleep 5; clear; done"
run herdr pane run "$EXEC_PANE" bash -c "$EXEC_CMD"

# --- Print layout summary ---
echo ""
echo "┌──────────────────────────────────────────┐"
echo "│  CyberBox Hunt Workspace Ready            │"
echo "├──────────────────────────────────────────┤"
echo "│  Main    ($MAIN_PANE)  Hunt Agent              │"
echo "│  Top-R   ($DASH_PANE)  Dashboard :$DASHBOARD_PORT      │"
echo "│  Bot-R   ($EXEC_PANE)  Exec Log (api :$API_PORT)  │"
echo "├──────────────────────────────────────────┤"
echo "│  Dashboard → http://localhost:$DASHBOARD_PORT/   │"
echo "│  hunt_dashboard.html                     │"
echo "└──────────────────────────────────────────┘"
echo ""
echo "Tip: start the control plane with:"
echo "  cd $CYBERBOX_DIR/platform/backend"
echo "  uv run uvicorn cyberbox.main:app --port $API_PORT"
