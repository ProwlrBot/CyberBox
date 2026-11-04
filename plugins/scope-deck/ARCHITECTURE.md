# ScopeDeck architecture

ScopeDeck is split into five layers:

1. CLI entrypoint
2. SQLite store and migrations
3. Source adapters and normalization
4. Scoring and draw engine
5. Embedded web UI plus REST API

## Key design choices

- SQLite is the system of record.
- FTS5 powers program search and note search.
- Imported data is never treated as authoritative without source metadata.
- All score contributors are explainable.
- Draw mode uses weighted sampling with diversity penalties, not pure randomness.

## Data flow

`source -> adapter -> normalized record -> snapshot -> program tables -> score/draw`

## CyberBox fit

- The plugin is installable via `csbx`.
- The UI is compatible with CyberBox's embedded browser.
- Handoff payloads are JSON documents that can be exported into CyberBox workflows.
