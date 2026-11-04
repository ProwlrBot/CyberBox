# ScopeDeck

ScopeDeck is a local catalog for authorized program research. It keeps the
program, policy, scope, source history, and selection score together so a
hunter can see why a target was suggested and where the data came from.

## What it is

- Local SQLite-backed program intelligence store.
- Weighted target selection with explainable scores.
- Source provenance and confidence tracking.
- Embedded web UI for CyberBox.
- JSON REST API for CyberBox workflows and CLI automation.

## What it is not

- Not a scanner.
- Not an exploit runner.
- Not an autonomous target executor. A selected program is still subject to
  its current published policy and scope.

## Commands

```bash
scopedeck serve
scopedeck sync --kind manual-json --source manual.json
scopedeck draw --mode beginner-entry
scopedeck programs search wordpress
scopedeck export scope --program <id>
```

The web server binds to `127.0.0.1:8321` by default. Set `SCOPEDECK_HOME`,
`SCOPEDECK_DB`, or `SCOPEDECK_ADDR` to change the data directory, database, or
listen address.

Remote sources must use HTTPS. ScopeDeck refuses private and reserved network
destinations, limits imports to 32 MiB, and records the raw source snapshot and
parser version with each sync. Community data stays labeled as community data;
it is never promoted to official scope by the scoring code.

## Plugin install

This repository includes a `csbx.yaml` manifest. CSBX displays the build hook
before compiling `bin/scopedeck` with SQLite FTS5 support.
