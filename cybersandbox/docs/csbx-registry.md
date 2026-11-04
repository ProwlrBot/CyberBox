# CSBX registry and install trust

CSBX reads the community catalog from
[ProwlrBot/csbx-registry](https://github.com/ProwlrBot/csbx-registry). A sync is
accepted only when the file matches the registry version supported by the
client and declares a valid intake-policy date. A bad download never replaces
the last valid local copy.

## Review before installing

```bash
csbx plan seclists
csbx plan --pdtm subfinder
csbx plan --caido <plugin>
```

The plan includes the registry and policy versions, source, pin status, trust
tier, and required confirmation. The Plugin Center displays the same fields.

Standard plugins are Git repositories with a `csbx.yaml` manifest. A commit or
release pin is checked out exactly and the resolved commit is stored in
`~/.csbx/installed.yaml`. An unpinned entry is marked mutable and requires an
extra confirmation. CSBX prints every hook before it runs; unattended hook
approval requires both `CSBX_YES=1` and `CSBX_ACCEPT_HOOKS=1`.

PDTM entries resolve to a Go module and version from the registry. Entries that
use `latest` remain visibly non-reproducible.

Caido plugins use the strict tier. CSBX downloads a declared release asset and
its matching signature material, verifies it with cosign or minisign, checks
the archive for traversal paths and symlinks, locates the declared manifest,
and then swaps it into the Caido plugin directory. A failed verification or
activation leaves the prior install in place.

## Operational behavior

- Mutating commands refuse to run as root unless `CSBX_ALLOW_ROOT=1` is set for
  a disposable installer environment.
- A per-home lock prevents overlapping install, update, remove, PDTM, and sync
  operations.
- Updates stop when a checkout contains local changes.
- Installation metadata is replaced atomically.
- `NO_COLOR=1` produces plain log output.

The registry is catalog and policy data, not an execution channel. Plugin code
only runs after an operator approves the displayed hook or command.
