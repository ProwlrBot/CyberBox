# csbx — port audit (spec 018, phase 3-1)

Inventory of `cybersandbox/harbinger-bin/csbx` (946 bash lines) for the Go
port. This document is the contract that phases 3-2 and 3-3 verify
against — every behaviour listed here must round-trip through the Go
implementation, and the existing bash test suite (`harbinger/tests/test_csbx.sh`)
is the regression baseline once the bash file becomes a shim.

## Source of truth

- Canonical path: `cybersandbox/harbinger-bin/csbx`
- Mirror: `harbinger/bin/csbx` (byte-identical at audit time, mtime-synced
  by the cybersandbox build; treat as a copy, NOT a separate target).
- Mirror divergence is a build bug — surface to the user; do not port it
  twice.

## Subcommand inventory

10 user-facing subcommands. Read-only is bench-testable without mutating
the host's `~/.csbx/`; mutating subcommands require a tempdir-isolated
`CSBX_HOME` in tests.

| # | Subcommand | Mode | Function | Lines | External deps |
|---|------------|------|----------|------:|---------------|
| 1 | `search [query]` | read-only | `cmd_search` | 194-211 | python3+yaml |
| 2 | `info <plugin>` | read-only | `cmd_info` | 213-244 | python3+yaml |
| 3 | `install <plugin\|url>` | mutating | `cmd_install` | 246-360 | python3+yaml, git, mktemp, hooks |
| 4 | `remove <plugin>` | mutating | `cmd_remove` | 362-420 | python3+yaml, hooks |
| 5 | `update <plugin\|--all>` | mutating | `cmd_update` | 422-478 | python3+yaml, git, hooks |
| 6 | `list [--available]` | read-only | `cmd_list` | 480-506 | python3+yaml |
| 7 | `sync` | mutating | `registry_sync` | 112-191 | curl |
| 8 | `pdtm <manifest\|path>` | mutating | `cmd_pdtm` | 574-646 | python3+yaml, go |
| 9 | `verify [flags]` | read-only | `cmd_verify` | 739-888 | cosign, docker, python3 |
| 10 | `doctor` | read-only | `cmd_doctor` | 509-562 | python3+yaml, du |

Plus the dispatcher at lines 933-946 and `usage()` at 890-929.

## Per-subcommand detail

### `csbx search [query]`

Searches the cached registry by name, description, and tags. Empty query
returns all plugins. Output is ANSI-coloured by hand (escape codes in
the python heredoc). No state mutation.

- **Lazy registry sync:** if `~/.csbx/registry.yaml` doesn't exist, calls
  `registry_sync()` first (lines 196). Go port should mirror this — empty
  user state is the default cold-start case.
- **Output format:** `<bold name> <type:20s> <size:>8s> <desc:60s>`.
  `column -t -s` is NOT used; alignment is via Python f-string padding
  inside the heredoc. The Go port should use `text/tabwriter` for the
  same effect (matches `cyberbox invoke-ollama -l`).
- **Search semantics:** substring match against `f"{name} {description} {tags joined}".lower()`.
  Case-insensitive, no glob support.
- **Port complexity:** LOW. Pure read of one YAML file + format.

### `csbx info <plugin>`

Prints a single plugin's full details from the registry plus its
installed-status (from `installed.yaml`).

- **Two-file read:** registry plus installed-state. Go port can pre-load
  both into typed structs.
- **Output format:** key-value pairs, ANSI-coloured.
- **Edge case:** plugin not in registry → red `[x] Plugin "name" not in registry`,
  return 0 (NOT 1). Go port preserves the exit code; this is a
  user-information command, not a fatal error.
- **Port complexity:** LOW.

### `csbx install <plugin|git-url>`

The largest read-write subcommand. Two input shapes:
1. **Registry name** (alphanumeric + dot/dash/underscore): looked up in
   `registry.yaml` to get `repo` URL.
2. **Direct URL** (starts with `http*` or `git@*`): cloned as-is, with a
   `warn` about reviewing `csbx.yaml` before trusting (line 256).

Steps (lines 246-360):
1. `validate_name` — reject `../` and non-alphanumeric (lines 89-96)
2. Idempotency check via inline python (lines 272-281): if already in
   `installed.yaml`, warn + return 0 (NOT 1).
3. `git clone --depth 1` to a `mktemp -d` (line 287-292). Failure → `rm -rf` tmp + return 1.
4. Read `csbx.yaml` manifest in the cloned repo for `type` (line 297).
   Defaults to `tool` if missing.
5. Move tmp → `${CSBX_PLUGINS}/${plugin_type}/${name}` (lines 302-305).
   **Deletes existing target dir** if present (line 304) — this is the
   "reinstall" path.
6. **Install hook** (lines 308-320): if `csbx.yaml.install` exists, prompt
   user via `confirm_hook` (lines 99-109). User Y/N runs the script in
   the plugin dir with `CSBX_PLUGIN_DIR + CSBX_WORDLISTS + CSBX_TEMPLATES + CSBX_BIN` env vars.
   `CSBX_YES=1` env var bypasses the prompt.
7. **Binary symlinks** (lines 322-327): each entry in `csbx.yaml.binaries`
   gets a symlink at `${CSBX_BIN}/$(basename $bin)` pointing to the file
   in the plugin dir.
8. **post_install hook** (lines 329-339): same shape as install hook.
9. **State write** to `installed.yaml` via inline python (lines 343-357).

**Port complexity: HIGH.** Hook execution is the load-bearing security
surface. The Go port MUST preserve:
- The user-confirmation prompt UX (review then Y/N), with `CSBX_YES=1` bypass.
- The exact env var passthrough (`CSBX_PLUGIN_DIR`, etc.).
- The atomic move semantics (mktemp clone, then `mv` to final location —
  no half-installed state if a hook fails).
- The "delete existing dir on reinstall" behaviour at line 304.

### `csbx remove <plugin>`

Inverse of install:
1. Look up path from `installed.yaml`.
2. Run `uninstall` hook with same confirm + env-passthrough as install.
3. Remove binary symlinks listed in `csbx.yaml.binaries`.
4. `rm -rf` the plugin dir.
5. Remove the entry from `installed.yaml`.

**Port complexity: MEDIUM.** Same hook-execution security surface as
install but a smaller code path.

### `csbx update <plugin|--all>`

Two modes:
- `--all`: enumerates every entry in `installed.yaml`, recursively calls
  itself per plugin (line 438). Linear time; no parallel update.
- Single plugin: `git -C <path> pull --ff-only`, then re-runs the install
  hook (with the same confirm prompt).

Notes:
- `pull --ff-only` is intentional — refuses to update if the upstream
  diverged. Go port preserves: surface a friendly error suggesting
  `csbx remove && csbx install`.
- The install hook re-runs on every update. The Go port must NOT skip this
  because some hooks build native binaries that need rebuilding.

**Port complexity: MEDIUM.**

### `csbx list [--available]`

Two modes:
- Default: prints `installed.yaml` plugins (name, type, path).
- `--available`: delegates to `cmd_search ""` (line 484).

**Port complexity: LOW.** Mostly formatting.

### `csbx sync`

Force-refreshes the registry from `CSBX_REGISTRY_URL` (default
`https://raw.githubusercontent.com/ProwlrBot/csbx-registry/main/registry.yaml`).

- **Idempotent overwrite:** writes to a `mktemp` then renames over
  `~/.csbx/registry.yaml` so partial fetches don't corrupt the cache.
- **Fallback:** if curl fails AND no registry exists yet, writes a hardcoded
  baseline registry of 10 plugins (lines 124-187). Go port should keep
  this as embedded `//go:embed` content for offline-first UX.

**Port complexity: LOW.** Pure HTTP GET + atomic rename.

### `csbx pdtm <manifest|path>`

Installs a Go tool via `go install`. Three input forms:
1. YAML manifest file with `name`, `repo`, `install_type`, `go_install_path`, `version`.
2. Bare go path (e.g. `github.com/projectdiscovery/subfinder/v2/cmd/subfinder`).
3. (Reserved) `install_type=binary` — explicitly NOT implemented (line 617),
   error out.

Steps:
1. Parse input. If manifest, read fields from YAML; if go path, derive `name = basename(path)`.
2. `validate_name`.
3. `command -v go` precheck. Error if missing.
4. `GOBIN=$CSBX_BIN go install $go_path@$version` (line 611). The `@version`
   defaults to `latest`.
5. Record in `installed.yaml` with `source: pdtm` so `update` can
   distinguish pdtm-installed tools from git-cloned ones (the current
   bash code does NOT actually special-case this on update — that's a
   latent bug to flag).

**Port complexity: MEDIUM.** `go install` subprocess + env injection.

### `csbx verify [flags]`

The supply-chain verifier (spec 009). Runs cosign keyless verification +
SBOM presence check + Rekor URL extraction against any locally pulled
cybersandbox image.

Flags (lines 746-794):
- `--image <repo>` (default `ghcr.io/prowlrbot/cybersandbox`)
- `--tag <tag>` (default `latest`)
- `--ref <repo:tag|repo@sha256:...>` (overrides image+tag)
- `--identity <regex>` (default pinned to `cybersandbox-build.yml@refs/`)
- `--oidc-issuer <url>` (default `https://token.actions.githubusercontent.com`)
- `--skip-sbom`, `--skip-rekor`, `-h/--help`

Pipeline:
1. Prerequisite checks: `command -v cosign`, `command -v docker`. Missing → exit 2 (NOT 1).
2. Resolve digest via `verify_resolve_digest` (lines 665-689):
   - If ref already has `@sha256:`, parse it.
   - Else try `docker buildx imagetools inspect --format '{{ .Manifest.Digest }}'` (no pull required).
   - Else fall back to `docker image inspect ... RepoDigests` (requires local pull).
3. `cosign verify <repo>@<digest> --certificate-identity-regexp <regex> --certificate-oidc-issuer <issuer>` (lines 830-833).
4. SBOM check via `docker buildx imagetools inspect --format '{{ json .SBOM }}'`.
   Asserts >= 64 bytes AND contains SPDX/CycloneDX markers.
5. Rekor URL extraction via Python heredoc (lines 695-712).
6. Pretty-print PASS report with image, digest, signer, rekor URL, fulcio search URL.

**Port complexity: HIGH.** Subprocess orchestration of cosign + docker,
JSON output parsing, identity regex pinning. Equivalent to a full
`go-cosign` integration plus `docker buildx` shelling. Don't try to
replace cosign with a Go library port — the trust model is "shell out to
the same cosign binary the user audited" so they can pin its sha256.
However: the `verify_extract_rekor_url` and `verify_extract_fulcio_url`
Python heredocs (lines 695-737) DO want native Go ports — they're just
JSON parsing.

**Exit codes are load-bearing:**
- 0: signed, transparency-logged, SBOM present
- 1: unsigned / tampered / verification failed
- 2: prerequisites missing

The bash test harness asserts these explicitly; Go port must match.

### `csbx doctor`

Health check. Read-only. Reports:
- Existence of `$CSBX_HOME`, `$CSBX_BIN`, `$CSBX_PLUGINS`.
- Broken symlinks in `$CSBX_BIN` (lines 522-530).
- `python3 + import yaml` availability.
- `command -v git`.
- Plugin count from `installed.yaml`.
- `du -sh $CSBX_PLUGINS` for storage stats.

**Port complexity: LOW.** Filesystem walks + subprocess invocations.
Note: the `python3 + import yaml` check becomes "self-test" in the Go
port — if the binary can run, the YAML parser is by definition available.

## Shared infrastructure

### YAML helpers

Three Python heredoc functions wrap `yaml.safe_load`:

| Helper | Lines | Purpose | Go equivalent |
|--------|------:|---------|---------------|
| `yaml_get` | 39-56 | Get a scalar at `a.b.c` path | typed struct + `gopkg.in/yaml.v3` |
| `yaml_get_block` | 58-71 | Get a multi-line string (hook scripts) | same |
| `yaml_list` | 73-87 | Iterate a list | same |

The bash safety pattern is **values via env vars, never string interpolation
into the python source**. Go port avoids this concern entirely (no shell
substitution risk).

### `confirm_hook(label, script)`

Lines 99-109. Prints the hook script with yellow `── label hook script ──`
delimiters, prompts `Run label hook? [y/N]`, returns 0 on `[Yy]`. Bypassed
by `CSBX_YES=1`.

**Port consideration:** the Go port needs the same trust UX. Don't auto-run
hooks; don't add a hidden "trust this once and remember" cache. Each
install/update is its own confirmation event.

### `validate_name`

Lines 89-96. Rejects:
- Names containing `../` (path traversal)
- Names with non-alphanumeric characters except `.`, `-`, `_`

Go port: `regexp.MustCompile(`^[a-zA-Z0-9._-]+$`).MatchString(name)` plus
explicit `strings.Contains(name, "../")` check. The double-check matters —
the regex denies `..` already, but the comment in the bash makes the
traversal intent explicit; preserve that comment in the Go port.

### `ensure_dirs`

Lines 28-36. Idempotent mkdir of state tree + PATH augmentation. The
PATH-mutation is a no-op for Go (the binary doesn't `exec` from `$CSBX_BIN`,
it just creates the dir). But the `mkdir -p` chain is still needed.

## External tool matrix

| Tool | Used by | Go port strategy |
|------|---------|------------------|
| `python3 + pyyaml` | search, info, install, remove, update, list, pdtm, doctor | Drop entirely — `gopkg.in/yaml.v3` |
| `git` | install, update | `os/exec` — keep as subprocess; don't try to use go-git for a `clone --depth 1` |
| `curl` | sync | `net/http` — direct HTTP GET |
| `cosign` | verify | `os/exec` — KEEP as subprocess (trust model) |
| `docker` | verify | `os/exec` — KEEP as subprocess (no Go SDK call substitutes for `buildx imagetools inspect`) |
| `go` | pdtm | `os/exec` (the user's `go` toolchain, NOT the cyberbox-bundled one) |
| `du` | doctor | `filepath.Walk` + size accumulation |
| `mktemp` | install, sync, verify | `os.MkdirTemp` |

## State file matrix

| File | Path | Reader subcommands | Writer subcommands | Format |
|------|------|--------------------|--------------------|--------|
| Registry | `~/.csbx/registry.yaml` | search, info, install (registry path), list (--available) | sync, registry_sync (lazy from search/info/install) | YAML, top-level `plugins: {name: {repo, type, description, size, tags}}` |
| Installed | `~/.csbx/installed.yaml` | info, install (idempotency check), remove, update, list, doctor, pdtm | install, remove, update, pdtm | YAML, top-level `plugins: {name: {type, repo, installed_at, path, source?}}` |
| Plugin dirs | `~/.csbx/plugins/<type>/<name>/` | install, remove, update | install, remove, update | git repo + optional `csbx.yaml` |
| Bin | `~/.csbx/bin/<binary>` | doctor (broken-symlink check) | install, remove, pdtm | symlinks (or actual files for pdtm `go install`) |

The Go port should design typed structs per file:

```go
type Registry struct {
    Version int                       `yaml:"version"`
    Plugins map[string]RegistryEntry  `yaml:"plugins"`
}

type RegistryEntry struct {
    Repo        string   `yaml:"repo"`
    Type        string   `yaml:"type"`
    Description string   `yaml:"description"`
    Size        string   `yaml:"size"`
    Tags        []string `yaml:"tags"`
}

type Installed struct {
    Plugins map[string]InstalledEntry `yaml:"plugins"`
}

type InstalledEntry struct {
    Type        string `yaml:"type"`
    Repo        string `yaml:"repo"`
    InstalledAt string `yaml:"installed_at"`
    Path        string `yaml:"path"`
    Source      string `yaml:"source,omitempty"` // "pdtm" or empty (git)
}

type Manifest struct {
    Type        string   `yaml:"type"`
    Binaries    []string `yaml:"binaries"`
    Install     string   `yaml:"install"`      // multi-line shell script
    PostInstall string   `yaml:"post_install"`
    Uninstall   string   `yaml:"uninstall"`
}
```

## Trust model

### Registry pinning
- `CSBX_REGISTRY_URL` env var pins the registry source. Default is
  `ProwlrBot/csbx-registry`. Anyone who controls that repo controls the
  trust root for unsigned plugin URLs (`install` falls back to
  user-provided URLs with a `warn` line, but registry-resolved URLs are
  treated as more trustworthy).
- **Spec 011** (csbx-registry intake CI) governs what lands in that repo.
  The Go port must NOT add a second registry source without explicit
  user consent.
- **Spec 012** (cybersandbox-slim) introduces signed binaries via
  `csbx install <tool>` — the registry entry will gain `signature_url`
  and `identity` fields. The Go port should design the `RegistryEntry`
  struct with these as optional fields now, even if they're not yet used.

### Cosign keyless identity
- `CSBX_VERIFY_IDENTITY_REGEX` defaults to
  `^https://github.com/ProwlrBot/CyberBox/.github/workflows/cybersandbox-build.yml@refs/`
  Anyone who can push to that workflow file can sign images that pass
  verification. The trust boundary is the GitHub workflow file's CODEOWNERS.
- The Go port surfaces this regex in `verify --help` so audit trails are
  greppable.

### Hook confirmation
- Every `install`, `post_install`, `uninstall` hook is shown to the user
  in full with `── label hook script ──` delimiters before Y/N.
- `CSBX_YES=1` bypasses for unattended use (Dockerfile, CI). The Go port
  must NOT add a `--yes` flag — env-only matches the bash and prevents
  accidental flag-shipping in scripts.

## Security considerations for the Go port

1. **Hook execution must remain shell-evaluated.** `csbx.yaml.install` strings
   contain shell pipelines; the Go port runs them via `bash -c` (or
   `sh -c` if `bash` is not available). Do NOT try to interpret as Go
   commands.
2. **Hook env passthrough is part of the contract.** Plugins rely on
   `CSBX_PLUGIN_DIR`, `CSBX_WORDLISTS`, `CSBX_TEMPLATES`, `CSBX_BIN`. The
   Go port must export these into the hook's environment. Plus inherit
   the user's `PATH` so `git`/`curl` etc. are usable inside hooks.
3. **`mv tmp -> target` (line 305) replaces existing dirs.** A `csbx install seclists`
   when `seclists/` already exists will silently overwrite. The bash
   has a `rm -rf` immediately before. Go port must preserve this — and
   document that `csbx install` IS the "reinstall" path.
4. **Path traversal is blocked twice** — once via `validate_name` (regex)
   and once via the constructed plugin path (`type/name`, both validated).
   But: the `--type` field comes from `csbx.yaml`, which the user just
   cloned. The Go port should `validate_name(plugin_type)` too — the bash
   doesn't, and it's a latent path-traversal vector for a malicious
   registry entry.
5. **YAML deserialisation must use `yaml.Unmarshal` into typed structs.** Avoid
   `interface{}` chains — they're how the bash heredocs work, but Go can
   do better, and typed structs make schema drift fail loudly at parse
   time instead of producing nil-coalesced silent garbage.
6. **Registry sync uses HTTP, not HTTPS-pinned.** Defaults are
   `https://raw.githubusercontent.com/...` — TLS via the system trust
   store. The Go port should use `crypto/tls` defaults (system store,
   no custom pinning) UNLESS an env override demands a specific cert.

## Port ordering recommendation

Phase 3-2 (read-only):
- `search`, `info`, `list`, `doctor`, `verify`
- These touch read-only state. `verify` is the heaviest because of cosign
  subprocess, but its outputs are idempotent — safe to test against a
  fixed digest in CI. SBOM/Rekor inspection can be mocked behind an
  interface for unit tests.

Phase 3-3a (registry sync):
- `sync` alone. Pure HTTP + atomic rename. Trivially testable with
  `httptest`.

Phase 3-3b (state-mutating with hooks):
- `install`, `remove`, `update` — these all share the hook execution
  path. Land them together so the hook-runner abstraction lives in one
  PR.
- This phase has the highest test surface: install/remove cycle,
  update --all, hook bypass via `CSBX_YES=1`, idempotent install,
  binary symlink lifecycle.

Phase 3-3c (Go subprocess invocation):
- `pdtm` — small, isolated to a `go install` subprocess. Land last
  because it depends on a Go toolchain being present in the user's
  PATH (a fact the cyberbox binary cannot self-test).

## Risk callouts for phases 3-2 and 3-3

| Risk | Mitigation |
|------|------------|
| Hook execution abuses elevated privileges if cyberbox is run as root | Document in `--help` that `csbx install` should never be run as root; consider an explicit `os.Geteuid() == 0` warning the first time |
| Registry hijack via DNS or compromised CDN | TLS via system store + immutable digest pinning is the cosign job; csbx itself relies on registry-author trust |
| `csbx.yaml.binaries` symlink path traversal (`../../bin/sudo`) | Validate each binary path is `filepath.IsLocal` to the plugin dir before symlinking |
| `csbx.yaml.type` path traversal | `validate_name` on type before constructing target dir (latent bash bug noted above) |
| `go install ...@latest` MITM | Go's checksumdb (sumdb) handles this; document that pdtm respects `GOSUMDB=off` only if the user explicitly sets it |
| Concurrent `csbx install` overwrites `installed.yaml` | Add `flock`-style mutex around `installed.yaml` writes in the Go port (the bash doesn't, and it's a latent lost-update race) |
| Symlink lifecycle on uninstall: a hook may have created binaries the manifest doesn't list | Document that uninstall removes ONLY `csbx.yaml.binaries` symlinks; hook-created files are the hook's responsibility |

## Out of scope for the bash → Go port

These are intentional non-goals for spec 018 phase 3:

- **csbx browse TUI** — spec 010, separate work item, never landed in bash.
- **Signed-binary install path** — spec 012's `csbx install <tool>` with
  cosign verify-blob; the registry struct accommodates it but actual
  enforcement waits on spec 012.
- **Plugin namespace per-org** — `csbx install someone/repo` shorthand.
  Bash currently treats anything with a `/` as a URL; Go port should
  preserve.
- **Lock files** — no `csbx.lock` analogue. Reproducibility is via the
  registry's pinned versions plus git's commit-sha resolution.
- **Plugin signing for community submissions** — spec 011 territory.

## Test surface for phase 3-2 and 3-3

The bash test suite at `harbinger/tests/test_csbx.sh` is the regression
baseline. Once the bash file becomes a shim, the same tests must pass
against the Go binary. Inventory of expected coverage (to be added in a
follow-up if not already present):

- `search` with empty query, with matching query, with no-match query
- `info` for installed plugin, for uninstalled-but-in-registry plugin, for unknown
- `install` from registry, from URL, with hook, with binaries, with `CSBX_YES=1`
- `remove` of plugin with hook, of plugin without hook, of nonexistent
- `update` single plugin, `--all`, on plugin with diverged upstream (assert friendly error)
- `list`, `list --available`
- `sync` with reachable registry, with unreachable registry (fallback to embedded)
- `pdtm` with manifest, with go-path, with missing toolchain (assert exit 1)
- `verify` with valid signed image, with `--skip-sbom`, with prereq missing (assert exit 2)
- `doctor` with healthy state, with broken symlinks, with missing pyyaml

## Reference for follow-ups

When phases 3-2 and 3-3 land, mark each subcommand done in cli/README.md's
status table. The Go port keeps the bash file as-is until phase 5
(spec 018) replaces it with a shim:

```bash
#!/usr/bin/env bash
exec "$(dirname "$0")/cyberbox" csbx "$@"
```

Until then, both bash and Go versions co-exist and `harbinger/tests/test_csbx.sh`
runs against the bash file (the regression baseline).
