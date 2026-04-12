#!/usr/bin/env bash
# Seed the cybersandbox-wordlists docker volume with a curated SecLists subset.
# Run once on host: ./scripts/seed-wordlists.sh
#
# Env overrides:
#   SECLISTS_REPO    — git URL (default: https://github.com/danielmiessler/SecLists.git)
#   SECLISTS_DEPTH   — clone depth (default: 1)
#   VOLUME_NAME      — docker volume (default: cybersandbox_cybersandbox-wordlists)
#   FULL             — set to 1 to seed full SecLists (~1GB) instead of curated subset

set -euo pipefail

SECLISTS_REPO="${SECLISTS_REPO:-https://github.com/danielmiessler/SecLists.git}"
SECLISTS_DEPTH="${SECLISTS_DEPTH:-1}"
VOLUME_NAME="${VOLUME_NAME:-cybersandbox_cybersandbox-wordlists}"
FULL="${FULL:-0}"

# Curated subset — the lists you actually use on ~95% of engagements
CURATED=(
  "Discovery/Web-Content/common.txt"
  "Discovery/Web-Content/raft-medium-words.txt"
  "Discovery/Web-Content/raft-medium-directories.txt"
  "Discovery/Web-Content/api/api-endpoints.txt"
  "Discovery/Web-Content/quickhits.txt"
  "Discovery/DNS/subdomains-top1million-5000.txt"
  "Discovery/DNS/subdomains-top1million-20000.txt"
  "Fuzzing/LFI/LFI-Jhaddix.txt"
  "Fuzzing/SQLi/Generic-SQLi.txt"
  "Fuzzing/XSS/XSS-Jhaddix.txt"
  "Passwords/Common-Credentials/10-million-password-list-top-10000.txt"
  "Passwords/Common-Credentials/best1050.txt"
  "Usernames/top-usernames-shortlist.txt"
)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "[*] Cloning SecLists (depth=$SECLISTS_DEPTH) → $TMP"
git clone --depth "$SECLISTS_DEPTH" "$SECLISTS_REPO" "$TMP/SecLists"

if [[ "$FULL" == "1" ]]; then
  SRC="$TMP/SecLists"
  echo "[*] FULL=1 — seeding complete SecLists"
else
  SRC="$TMP/curated"
  mkdir -p "$SRC"
  for f in "${CURATED[@]}"; do
    if [[ -f "$TMP/SecLists/$f" ]]; then
      mkdir -p "$SRC/$(dirname "$f")"
      cp "$TMP/SecLists/$f" "$SRC/$f"
    else
      echo "  [!] missing upstream: $f" >&2
    fi
  done
  echo "[*] Seeded $(find "$SRC" -type f | wc -l) curated wordlists"
fi

echo "[*] Ensuring volume exists: $VOLUME_NAME"
docker volume create "$VOLUME_NAME" >/dev/null

echo "[*] Copying into volume..."
docker run --rm \
  -v "$SRC":/src:ro \
  -v "$VOLUME_NAME":/dst \
  alpine sh -c 'cp -r /src/. /dst/ && chmod -R a+r /dst'

echo "[✓] Wordlists volume seeded. Mount point inside cybersandbox: /wordlists"
