# CyberSandbox image-size audit methodology

A repeatable per-release procedure for keeping the full CyberSandbox image
lean without dropping any of the pinned 160+ tools. Run this every time
the Dockerfile changes substantially or quarterly, whichever comes first.

This is the methodology used for spec-015 (initial 20%+ reduction pass).
The CI workflow `cybersandbox-build.yml` publishes the resulting size as
a per-release metric — see "CI metric" below.

## TL;DR — quick audit (≈10 minutes)

```bash
cd cybersandbox

# 1. Baseline — what's in the current image?
docker buildx build --load -t cybersandbox:audit-before .
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' cybersandbox:audit-before

# 2. Layer breakdown — which RUN steps are heavy?
docker history --no-trunc --format 'table {{.Size}}\t{{.CreatedBy}}' cybersandbox:audit-before \
  | sort -h -k1 \
  | tee image-size-layers.log

# 3. On-disk hot spots — what's bulky inside the rootfs?
docker run --rm --entrypoint sh cybersandbox:audit-before -c \
  'du -shx /usr/* /opt/* /var/* /root/* 2>/dev/null | sort -h' \
  | tee image-size-rootfs.log

# 4. Apply optimizations (see "Optimization vectors" below).

# 5. Re-measure.
docker buildx build --load -t cybersandbox:audit-after .
docker images --format '{{.Size}}' cybersandbox:audit-after
```

Compare the two `Size` values. The spec-015 acceptance bar is ≥20%
reduction; treat <10% as a regression and investigate.

## Build-time measurement

```bash
# Cold build (no cache) — closest to a contributor's first build.
docker buildx prune -af
time docker buildx build --no-cache --load -t cybersandbox:cold .

# Warm build (cache mounts populated) — closest to CI rebuild path.
time docker buildx build --load -t cybersandbox:warm .
```

The spec-015 acceptance bar is ≥15% reduction in cold-build time. Most
of that comes from `--mount=type=cache` for `/root/.cache/go-build` and
`/go/pkg/mod` in the go-builder stage.

## What to look for — high-leverage signals

Run `docker history` and triage layers in this order:

1. **Layers >500 MB** — almost always cache or duplicated content. Common
   offenders:
   - `/var/lib/apt/lists/*` left from a missing `rm -rf`.
   - `/root/.cache/pip` or `/root/.npm` from package installs.
   - `/root/.cache/go-build` from in-image `go install` (use BuildKit
     cache mounts instead — see Dockerfile go-builder stage).
   - `/usr/share/doc/*`, `/usr/share/man/*`, `/usr/share/locale/*`.
2. **Compile-time toolchains in the final stage** — anything that's only
   needed to *build* a binary (build-essential, pkg-config, header-only
   `*-dev` packages, gcc, make) should live in the builder stage. The
   final stage should only carry the prebuilt binary plus its runtime
   shared libs.
3. **Duplicated wordlists** — SecLists is ~1 GB. The full image must NOT
   bake it in; it ships via the `cybersandbox-wordlists` Docker volume,
   seeded by `scripts/seed-wordlists.sh`. If a future PR ever adds
   `git clone .../SecLists` in the Dockerfile, reject it.
4. **Multiple `apt-get update` runs** — each one downloads ~30 MB of
   index that lives in its own layer until you `rm -rf` it. Merge into a
   single RUN, or guarantee every update is paired with a final cleanup.
5. **Language runtimes you don't use at runtime** — Crystal is required
   for some scanners; Python, Go binaries, Node (for Claude Code), and
   Ruby (for Metasploit) are required. Confirm before considering removal.

## Optimization vectors (in priority order)

These were applied during spec-015. Before re-applying, re-measure: an
optimization that worked once may already be in place.

| Vector                                            | Mechanism                                                                  | Estimated savings |
|---------------------------------------------------|----------------------------------------------------------------------------|------------------:|
| BuildKit cache mounts for go-builder              | `--mount=type=cache,target=/root/.cache/go-build` and `/go/pkg/mod`        | -3 to -6 min cold |
| Drop compile-time apt deps from final stage       | Remove `build-essential`, `pkg-config`, swap `libpcap-dev` → `libpcap0.8`  |       ~250–400 MB |
| Single apt RUN with shared cleanup                | One `apt-get update`/`rm -rf /var/lib/apt/lists/*` for system+crystal      |        ~30–60 MB |
| Strip `/usr/share/{doc,man,info,locale}`          | Append to the system-deps RUN                                              |        ~80–150 MB |
| Disable pip wheel cache & bytecode                | `pip install --no-cache-dir --no-compile`; rm `__pycache__`                |        ~40–80 MB |
| `npm cache clean --force` + rm `/root/.npm`       | Same RUN that installs `@anthropic-ai/claude-code`                         |        ~80–120 MB |
| Remove `/root/.oh-my-zsh/.git`                    | OMZ keeps full upstream git history by default                             |        ~10–20 MB |
| Strip Go binaries (`-ldflags=-s -w`, `-trimpath`) | Set `GOFLAGS` in go-builder; only affects produced binaries                |        ~80–120 MB |
| Layer ordering: most-changed last                 | `prowl-bin/`, `mcp-hub-cyber.json`, `entrypoint-cyber.sh` last         |   cache wins only |

## What NOT to drop

The following are tempting but load-bearing — leave them alone:

- **Crystal** — required by certain pinned scanners; cannot be
  side-loaded at runtime without breaking the "agent-native" UX.
- **mitmproxy / tshark / tcpdump** — interactive workflows depend on
  them; users expect them on PATH.
- **Python venv at `/opt/venv`** — entrypoint and several CLIs depend
  on the venv's `PATH` ordering.
- **Metasploit** — pinned-tools list. ~600 MB but non-negotiable.
- **`@anthropic-ai/claude-code`** — pinned-tools list.

## CI metric (publish per release)

`cybersandbox-build.yml` runs `docker images --format '{{.Size}}'` on the
locally-built image after the smoke test and writes the value to
`$GITHUB_STEP_SUMMARY` plus an `image-size.txt` artifact. To track the
trend across releases:

1. Find the workflow run for the release tag.
2. Inspect the run summary — the "Image size" section reports the
   value for that build.
3. Pull the `image-size.txt` artifact for machine-readable input into a
   long-running trend dashboard (recommend GitHub's "metrics" tab or
   any external store).

If the image size grows >5% release-over-release without a
corresponding tools-list change, re-run the audit (this document).

## Verification checklist before merging an optimization PR

- [ ] `docker buildx build --load -t cybersandbox:after .` succeeds.
- [ ] `cybersandbox-build.yml` smoke test passes locally
      (`for bin in nuclei subfinder ...; do command -v "$bin"; done`).
- [ ] `docker images` shows ≥20% reduction vs. the prior release tag.
- [ ] Cold build time (after `docker buildx prune -af`) is ≥15% faster.
- [ ] No new entries in `.trivyignore` introduced by removing packages.
- [ ] `cybersandbox/CHANGELOG.md` updated with before/after numbers.

## Historical record

Track each pass here so future audits know what's already been picked.

| Date       | Spec     | Before  | After   | Δ size  | Δ cold build |
|------------|----------|---------|---------|---------|--------------|
| 2026-04-24 | spec-015 | ~11.4 GB | ~8.6 GB est. | -24% est. | -18% est. |
