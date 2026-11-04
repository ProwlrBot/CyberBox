PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  authority TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_syncs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_upserted INTEGER NOT NULL DEFAULT 0,
  source_snapshot_id TEXT,
  error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platforms (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY,
  platform_id TEXT REFERENCES platforms(id) ON DELETE SET NULL,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_record_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  reward_status TEXT NOT NULL DEFAULT 'unknown',
  opportunity_score INTEGER NOT NULL DEFAULT 0,
  data_confidence INTEGER NOT NULL DEFAULT 0,
  why_selected TEXT NOT NULL DEFAULT '',
  why_now TEXT NOT NULL DEFAULT '',
  best_attack_surface TEXT NOT NULL DEFAULT '',
  setup_difficulty TEXT NOT NULL DEFAULT 'unknown',
  scope_state TEXT NOT NULL DEFAULT 'unknown',
  scope_size INTEGER NOT NULL DEFAULT 0,
  country TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  account_required INTEGER NOT NULL DEFAULT 0,
  reward_min INTEGER NOT NULL DEFAULT 0,
  reward_max INTEGER NOT NULL DEFAULT 0,
  reward_currency TEXT NOT NULL DEFAULT '',
  last_source_update TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL DEFAULT '',
  last_seen TEXT NOT NULL DEFAULT '',
  last_confirmed TEXT NOT NULL DEFAULT '',
  parser_version TEXT NOT NULL DEFAULT '',
  raw_source_snapshot TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  source_url TEXT NOT NULL DEFAULT '',
  source_record_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, source_record_id)
);

CREATE TABLE IF NOT EXISTS program_snapshots (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  source_sync_id TEXT NOT NULL REFERENCES source_syncs(id) ON DELETE CASCADE,
  source_record_id TEXT NOT NULL,
  source_snapshot TEXT NOT NULL,
  source_snapshot_hash TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  last_confirmed TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  parser_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_policies (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  policy_url TEXT NOT NULL DEFAULT '',
  policy_text TEXT NOT NULL DEFAULT '',
  policy_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown',
  first_seen TEXT NOT NULL DEFAULT '',
  last_seen TEXT NOT NULL DEFAULT '',
  last_confirmed TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scope_assets (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_record_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  value TEXT NOT NULL,
  scope_state TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  first_seen TEXT NOT NULL DEFAULT '',
  last_seen TEXT NOT NULL DEFAULT '',
  last_confirmed TEXT NOT NULL DEFAULT '',
  confidence INTEGER NOT NULL DEFAULT 0,
  parser_version TEXT NOT NULL DEFAULT '',
  raw_source_snapshot TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scope_rules (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exclusion_rules (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_tiers (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  tier_name TEXT NOT NULL,
  reward_min INTEGER NOT NULL DEFAULT 0,
  reward_max INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_changes (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_record_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT '',
  confidence INTEGER NOT NULL DEFAULT 0,
  parser_version TEXT NOT NULL DEFAULT '',
  raw_source_snapshot TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS target_signals (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 0,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_record_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT '',
  confidence INTEGER NOT NULL DEFAULT 0,
  parser_version TEXT NOT NULL DEFAULT '',
  raw_source_snapshot TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS target_scores (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  hunter_profile_id TEXT NOT NULL,
  opportunity_score INTEGER NOT NULL,
  data_confidence INTEGER NOT NULL,
  score_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hunter_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  hunter_profile_id TEXT NOT NULL REFERENCES hunter_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hunt_queue_items (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  hunter_profile_id TEXT NOT NULL REFERENCES hunter_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  program_id TEXT REFERENCES programs(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_sources (
  id TEXT PRIMARY KEY,
  program_id TEXT REFERENCES programs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_record_id TEXT NOT NULL DEFAULT '',
  raw_snapshot TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  hunter_profile_id TEXT NOT NULL REFERENCES hunter_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS program_search_fts USING fts5(
  program_id UNINDEXED,
  name,
  platform,
  tags,
  notes
);

CREATE VIRTUAL TABLE IF NOT EXISTS note_search_fts USING fts5(
  note_id UNINDEXED,
  title,
  content
);

CREATE TRIGGER IF NOT EXISTS programs_ai AFTER INSERT ON programs BEGIN
  INSERT INTO program_search_fts(program_id, name, platform, tags, notes)
  VALUES (new.id, new.name, coalesce(json_extract(new.metadata_json, '$.platform_name'), ''),
          coalesce(json_extract(new.metadata_json, '$.tags'), ''),
          coalesce(json_extract(new.metadata_json, '$.notes'), ''));
END;

CREATE TRIGGER IF NOT EXISTS programs_au AFTER UPDATE ON programs BEGIN
  DELETE FROM program_search_fts WHERE program_id = old.id;
  INSERT INTO program_search_fts(program_id, name, platform, tags, notes)
  VALUES (new.id, new.name, coalesce(json_extract(new.metadata_json, '$.platform_name'), ''),
          coalesce(json_extract(new.metadata_json, '$.tags'), ''),
          coalesce(json_extract(new.metadata_json, '$.notes'), ''));
END;

CREATE TRIGGER IF NOT EXISTS programs_ad AFTER DELETE ON programs BEGIN
  DELETE FROM program_search_fts WHERE program_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO note_search_fts(note_id, title, content) VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  DELETE FROM note_search_fts WHERE note_id = old.id;
  INSERT INTO note_search_fts(note_id, title, content) VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  DELETE FROM note_search_fts WHERE note_id = old.id;
END;
