# ScopeDeck database model

The current sync and query path writes these tables:

- `sources`
- `source_syncs`
- `platforms`
- `programs`
- `program_snapshots`
- `program_policies`
- `scope_assets`
- `program_changes`
- `target_signals`
- `hunter_profiles`

The schema also reserves tables for saved decks and later workflow features:

- `scope_rules`
- `exclusion_rules`
- `reward_tiers`
- `target_scores`
- `decks`
- `hunt_queue_items`
- `watchlists`
- `notes`
- `evidence_sources`
- `notification_rules`

FTS5 indexes program names and notes:

- `program_search_fts`
- `note_search_fts`
