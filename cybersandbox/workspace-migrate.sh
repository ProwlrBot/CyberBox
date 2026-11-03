#!/bin/sh
set -eu

home="${CYBERBOX_WORKSPACE_HOME:-/home/hunter}"
state="$home/.cyberbox"
migrations="$state/migrations"

mkdir -p "$migrations" \
  "$home/exports/evidence" \
  "$home/exports/findings" \
  "$home/exports/reports"
chmod 700 "$state" "$migrations" 2>/dev/null || true

apply_001() {
  destination="$state/cyberbox.db"
  [ -e "$destination" ] && return 0

  for source in \
    "$state/neo.db" \
    "$home/.neo/neo.db" \
    "$home/neo.db"
  do
    if [ -f "$source" ] && [ ! -L "$source" ]; then
      cp -p "$source" "$destination"
      chmod 600 "$destination" 2>/dev/null || true
      printf '%s\n' "$source" > "$migrations/001-legacy-database.source"
      break
    fi
  done
}

if [ ! -f "$migrations/001-workspace-layout" ]; then
  apply_001
  printf '%s\n' "workspace layout and legacy database compatibility" > \
    "$migrations/001-workspace-layout"
fi

# The overlay runs as root before the upstream entrypoint drops privileges.
# Keep control-plane state and export directories accessible to the configured
# workspace user without weakening their private modes.
chown -R "${USER_UID:-1000}:${USER_GID:-1000}" "$state" "$home/exports" 2>/dev/null || true

echo "[+] Workspace migrations ready (schema 001)"
