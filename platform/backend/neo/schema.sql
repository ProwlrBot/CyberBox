-- Neo platform — local-first schema (SQLite, WAL mode).
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'member',
    api_key     TEXT UNIQUE NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS asset_groups (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'Uncategorized',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    group_id     TEXT REFERENCES asset_groups(id) ON DELETE SET NULL,
    host         TEXT NOT NULL,
    port         INTEGER NOT NULL DEFAULT 443,
    scheme       TEXT NOT NULL DEFAULT 'https',
    status_code  INTEGER,
    ip           TEXT,
    asn          TEXT,
    cname        TEXT,
    service      TEXT,
    technologies TEXT NOT NULL DEFAULT '[]',
    labels       TEXT NOT NULL DEFAULT '[]',
    metadata     TEXT NOT NULL DEFAULT '{}',
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    UNIQUE (project_id, host, port, scheme)
);

CREATE TABLE IF NOT EXISTS templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    template_id TEXT NOT NULL,
    category    TEXT NOT NULL,
    severity    TEXT NOT NULL DEFAULT 'info',
    source      TEXT NOT NULL DEFAULT 'builtin',
    yaml        TEXT NOT NULL,
    tags        TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    UNIQUE (template_id)
);

CREATE TABLE IF NOT EXISTS vulnerabilities (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id      TEXT REFERENCES assets(id) ON DELETE SET NULL,
    template_id   TEXT,
    name          TEXT NOT NULL,
    severity      TEXT NOT NULL DEFAULT 'info',
    category      TEXT NOT NULL DEFAULT 'Misconfiguration',
    description   TEXT NOT NULL DEFAULT '',
    cve           TEXT,
    host          TEXT,
    matched_at    TEXT,
    status        TEXT NOT NULL DEFAULT 'open',
    verified      INTEGER NOT NULL DEFAULT 0,
    poc           TEXT NOT NULL DEFAULT '',
    request_chain TEXT NOT NULL DEFAULT '[]',
    tags          TEXT NOT NULL DEFAULT '[]',
    dedup_key     TEXT,
    sla_due       TEXT,
    detected_at   TEXT NOT NULL,
    fixed_at      TEXT,
    UNIQUE (project_id, dedup_key)
);

CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'pentest',
    target          TEXT NOT NULL DEFAULT '',
    scope           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'queued',
    assignee        TEXT,
    phase_checklist TEXT NOT NULL DEFAULT '[]',
    severity_counts TEXT NOT NULL DEFAULT '{}',
    working_memory  TEXT NOT NULL DEFAULT '{}',
    started_at      TEXT,
    finished_at     TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'recon',
    status      TEXT NOT NULL DEFAULT 'idle',
    task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    sandbox_id  TEXT,
    provider    TEXT NOT NULL DEFAULT 'ollama',
    model       TEXT NOT NULL DEFAULT '',
    egress_ip   TEXT,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    target      TEXT NOT NULL,
    tool        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',
    log         TEXT NOT NULL DEFAULT '',
    stats       TEXT NOT NULL DEFAULT '{}',
    started_at  TEXT,
    finished_at TEXT,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS network_traffic (
    id           TEXT PRIMARY KEY,
    agent_id     TEXT,
    task_id      TEXT,
    method       TEXT NOT NULL,
    url          TEXT NOT NULL,
    host         TEXT NOT NULL,
    path         TEXT NOT NULL,
    status       INTEGER,
    req_headers  TEXT NOT NULL DEFAULT '{}',
    resp_headers TEXT NOT NULL DEFAULT '{}',
    req_body     TEXT NOT NULL DEFAULT '',
    resp_body    TEXT NOT NULL DEFAULT '',
    timing_ms    INTEGER,
    size         INTEGER,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'available',
    auth_kind   TEXT NOT NULL DEFAULT 'apikey',
    config      TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    UNIQUE (type)
);

CREATE TABLE IF NOT EXISTS prompts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    command     TEXT NOT NULL,
    body        TEXT NOT NULL,
    variables   TEXT NOT NULL DEFAULT '[]',
    scope       TEXT NOT NULL DEFAULT 'team',
    created_at  TEXT NOT NULL,
    UNIQUE (command)
);

CREATE TABLE IF NOT EXISTS sla_policy (
    severity    TEXT PRIMARY KEY,
    days        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_project   ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_vulns_project    ON vulnerabilities(project_id);
CREATE INDEX IF NOT EXISTS idx_vulns_severity   ON vulnerabilities(severity);
CREATE INDEX IF NOT EXISTS idx_vulns_status     ON vulnerabilities(status);
CREATE INDEX IF NOT EXISTS idx_traffic_host     ON network_traffic(host);
CREATE INDEX IF NOT EXISTS idx_tasks_project    ON tasks(project_id);
