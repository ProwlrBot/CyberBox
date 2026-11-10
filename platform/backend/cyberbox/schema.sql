-- CyberBox platform — local-first schema (SQLite, WAL mode).
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

CREATE TABLE IF NOT EXISTS project_templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    profile_id  TEXT NOT NULL,
    maturity    TEXT NOT NULL DEFAULT 'preview',
    manifest    TEXT NOT NULL,
    builtin     INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS project_targets (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'domain',
    pattern     TEXT NOT NULL,
    normalized  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'candidate',
    source      TEXT NOT NULL DEFAULT 'manual',
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (project_id, target_type, normalized)
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

CREATE TABLE IF NOT EXISTS engagements (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    profile_id       TEXT NOT NULL DEFAULT 'bug-bounty' REFERENCES profiles(id),
    autonomy         TEXT NOT NULL DEFAULT 'balanced',
    status           TEXT NOT NULL DEFAULT 'active',
    scope_version    INTEGER NOT NULL DEFAULT 1,
    budget           TEXT NOT NULL DEFAULT '{}',
    policy           TEXT NOT NULL DEFAULT '{}',
    starts_at        TEXT,
    ends_at          TEXT,
    created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scope_rules_v2 (
    id               TEXT PRIMARY KEY,
    engagement_id    TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    effect           TEXT NOT NULL DEFAULT 'include',
    resource_type    TEXT NOT NULL DEFAULT 'domain',
    pattern          TEXT NOT NULL,
    ports            TEXT NOT NULL DEFAULT '[]',
    methods          TEXT NOT NULL DEFAULT '[]',
    max_requests_min INTEGER,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scope_acknowledgments (
    id                    TEXT PRIMARY KEY,
    engagement_id         TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    authorization_status  TEXT NOT NULL,
    policy_reference      TEXT NOT NULL DEFAULT '',
    acknowledged_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
    acknowledgment         TEXT NOT NULL,
    allowed_methods        TEXT NOT NULL DEFAULT '["GET","HEAD"]',
    rate_limit_per_minute  INTEGER NOT NULL DEFAULT 30,
    concurrency_limit      INTEGER NOT NULL DEFAULT 2,
    destructive_actions    TEXT NOT NULL DEFAULT 'blocked',
    credential_testing     TEXT NOT NULL DEFAULT 'blocked',
    data_handling          TEXT NOT NULL DEFAULT '',
    expires_at             TEXT,
    created_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_tokens (
    id             TEXT PRIMARY KEY,
    token_digest   TEXT UNIQUE NOT NULL,
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    engagement_id  TEXT REFERENCES engagements(id) ON DELETE CASCADE,
    subject_type   TEXT NOT NULL DEFAULT 'panel',
    subject_id     TEXT NOT NULL,
    permissions    TEXT NOT NULL DEFAULT '[]',
    status         TEXT NOT NULL DEFAULT 'active',
    issued_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
    issued_at      TEXT NOT NULL,
    expires_at     TEXT NOT NULL,
    last_used_at   TEXT,
    revoked_at     TEXT,
    metadata       TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS executions (
    id               TEXT PRIMARY KEY,
    engagement_id    TEXT REFERENCES engagements(id) ON DELETE CASCADE,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'queued',
    risk_class       TEXT NOT NULL DEFAULT 'passive',
    input            TEXT NOT NULL DEFAULT '{}',
    output           TEXT NOT NULL DEFAULT '{}',
    budget           TEXT NOT NULL DEFAULT '{}',
    idempotency_key  TEXT,
    lease_owner      TEXT,
    lease_expires_at TEXT,
    attempt          INTEGER NOT NULL DEFAULT 0,
    error            TEXT,
    started_at       TEXT,
    finished_at      TEXT,
    created_at       TEXT NOT NULL,
    UNIQUE (project_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS execution_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id TEXT REFERENCES executions(id) ON DELETE CASCADE,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_type   TEXT NOT NULL,
    actor_type   TEXT NOT NULL DEFAULT 'system',
    actor_id     TEXT,
    data         TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL,
    media_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
    sha256       TEXT NOT NULL,
    size         INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    metadata     TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL,
    UNIQUE (project_id, sha256, kind)
);

CREATE TABLE IF NOT EXISTS approvals (
    id           TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    action_class TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    reason       TEXT NOT NULL DEFAULT '',
    decided_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    decided_at   TEXT,
    expires_at   TEXT,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    version      TEXT NOT NULL,
    maturity     TEXT NOT NULL DEFAULT 'preview',
    manifest     TEXT NOT NULL,
    builtin      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    UNIQUE (id, version)
);

CREATE TABLE IF NOT EXISTS knowledge_packs (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    version      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'installed',
    source_url   TEXT NOT NULL,
    license      TEXT NOT NULL,
    sha256       TEXT NOT NULL,
    signature    TEXT,
    manifest     TEXT NOT NULL,
    installed_at TEXT NOT NULL,
    UNIQUE (id, version)
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id          TEXT PRIMARY KEY,
    pack_id     TEXT NOT NULL,
    pack_version TEXT NOT NULL,
    title       TEXT NOT NULL,
    source_url  TEXT NOT NULL,
    license     TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    FOREIGN KEY (pack_id, pack_version) REFERENCES knowledge_packs(id, version) ON DELETE CASCADE,
    UNIQUE (pack_id, pack_version, source_url)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    section     TEXT NOT NULL DEFAULT '',
    ordinal     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    search_text TEXT NOT NULL,
    UNIQUE (document_id, ordinal)
);

CREATE TABLE IF NOT EXISTS research_feedback (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    engagement_id TEXT REFERENCES engagements(id) ON DELETE SET NULL,
    subject_type TEXT NOT NULL,
    subject_id   TEXT NOT NULL,
    disposition  TEXT NOT NULL,
    notes        TEXT NOT NULL DEFAULT '',
    artifact_ids TEXT NOT NULL DEFAULT '[]',
    created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_suggestions (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    feedback_id  TEXT NOT NULL REFERENCES research_feedback(id) ON DELETE CASCADE,
    profile_id   TEXT NOT NULL,
    title        TEXT NOT NULL,
    lesson       TEXT NOT NULL,
    technology_tags TEXT NOT NULL DEFAULT '[]',
    evidence_ids TEXT NOT NULL DEFAULT '[]',
    status       TEXT NOT NULL DEFAULT 'pending',
    decided_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    decided_at   TEXT,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_memory (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
    profile_id   TEXT NOT NULL,
    title        TEXT NOT NULL,
    lesson       TEXT NOT NULL,
    technology_tags TEXT NOT NULL DEFAULT '[]',
    evidence_ids TEXT NOT NULL DEFAULT '[]',
    source_feedback_id TEXT NOT NULL REFERENCES research_feedback(id) ON DELETE CASCADE,
    approved_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    approved_at  TEXT NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS evaluation_fixtures (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    fixture_type TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id   TEXT NOT NULL,
    expected     TEXT NOT NULL,
    artifact_ids TEXT NOT NULL DEFAULT '[]',
    source_feedback_id TEXT NOT NULL REFERENCES research_feedback(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playbooks (
    id           TEXT NOT NULL,
    version      TEXT NOT NULL,
    name         TEXT NOT NULL,
    profile_id   TEXT NOT NULL REFERENCES profiles(id),
    maturity     TEXT NOT NULL DEFAULT 'preview',
    manifest     TEXT NOT NULL,
    builtin      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS playbook_runs (
    id               TEXT PRIMARY KEY,
    playbook_id      TEXT NOT NULL,
    playbook_version TEXT NOT NULL,
    engagement_id    TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'queued',
    inputs           TEXT NOT NULL DEFAULT '{}',
    context          TEXT NOT NULL DEFAULT '{}',
    current_step     INTEGER NOT NULL DEFAULT 0,
    created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
    started_at       TEXT,
    finished_at      TEXT,
    created_at       TEXT NOT NULL,
    FOREIGN KEY (playbook_id, playbook_version) REFERENCES playbooks(id, version)
);

CREATE TABLE IF NOT EXISTS playbook_steps (
    id           TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL REFERENCES playbook_runs(id) ON DELETE CASCADE,
    step_index   INTEGER NOT NULL,
    step_id      TEXT NOT NULL,
    execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    input        TEXT NOT NULL DEFAULT '{}',
    output       TEXT NOT NULL DEFAULT '{}',
    error        TEXT,
    started_at   TEXT,
    finished_at  TEXT,
    UNIQUE (run_id, step_index)
);

CREATE TABLE IF NOT EXISTS hypotheses (
    id                    TEXT PRIMARY KEY,
    project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    engagement_id         TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    asset_id              TEXT REFERENCES assets(id) ON DELETE SET NULL,
    title                 TEXT NOT NULL,
    claim                 TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'proposed',
    confidence            TEXT NOT NULL DEFAULT 'low',
    supporting_artifacts  TEXT NOT NULL DEFAULT '[]',
    contradicting_artifacts TEXT NOT NULL DEFAULT '[]',
    knowledge_citations   TEXT NOT NULL DEFAULT '[]',
    created_by            TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiments (
    id              TEXT PRIMARY KEY,
    hypothesis_id   TEXT NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
    execution_id    TEXT REFERENCES executions(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    procedure       TEXT NOT NULL,
    risk_class      TEXT NOT NULL DEFAULT 'low-impact',
    target_url      TEXT NOT NULL,
    method          TEXT NOT NULL DEFAULT 'GET',
    expected_signal TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    result          TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL,
    finished_at     TEXT
);

CREATE TABLE IF NOT EXISTS finding_reviews (
    id            TEXT PRIMARY KEY,
    vulnerability_id TEXT NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
    reviewer_type TEXT NOT NULL,
    verdict       TEXT NOT NULL,
    confidence    TEXT NOT NULL,
    rationale     TEXT NOT NULL,
    artifact_ids  TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finding_links (
    vulnerability_id TEXT NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
    hypothesis_id    TEXT REFERENCES hypotheses(id) ON DELETE SET NULL,
    experiment_id    TEXT REFERENCES experiments(id) ON DELETE SET NULL,
    PRIMARY KEY (vulnerability_id, experiment_id)
);

CREATE TABLE IF NOT EXISTS evidence_bundles (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    manifest_sha256 TEXT NOT NULL,
    signature   TEXT NOT NULL,
    public_key  TEXT NOT NULL,
    finding_ids TEXT NOT NULL DEFAULT '[]',
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
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

-- Model provider configuration (UI/API-managed, not hardcoded)
CREATE TABLE IF NOT EXISTS model_providers (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'openai_compat',
    -- kind values: openai_compat | anthropic | ollama | custom
    base_url      TEXT NOT NULL,
    api_key_env   TEXT,
    -- env var name to read the key from (e.g. OPENAI_API_KEY); NULL for local
    default_model TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    local         INTEGER NOT NULL DEFAULT 0,
    -- local=1 providers are always allowed; local=0 requires allow_external
    metadata      TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL,
    UNIQUE (name)
);

-- Normalized endpoint inventory — populated by HAR/OpenAPI/Burp/Caido ingest
CREATE TABLE IF NOT EXISTS endpoints (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source           TEXT NOT NULL DEFAULT 'manual',
    -- source values: har | openapi | burp | caido | manual
    method           TEXT NOT NULL,
    host             TEXT NOT NULL,
    path             TEXT NOT NULL,
    path_template    TEXT,
    -- e.g. /api/users/{id} normalized from /api/users/123
    params           TEXT NOT NULL DEFAULT '[]',
    -- JSON: [{name, in, required, type}]
    auth_required    INTEGER NOT NULL DEFAULT 0,
    auth_schemes     TEXT NOT NULL DEFAULT '[]',
    -- JSON: [bearer|cookie|apikey|basic]
    content_types    TEXT NOT NULL DEFAULT '[]',
    request_body_schema TEXT,
    -- JSON Schema inferred from OpenAPI spec
    status_codes     TEXT NOT NULL DEFAULT '[]',
    tags             TEXT NOT NULL DEFAULT '[]',
    drift_flags      TEXT NOT NULL DEFAULT '[]',
    -- JSON: [{field, declared, observed}] drift between spec and traffic
    first_seen_at    TEXT NOT NULL,
    last_seen_at     TEXT NOT NULL,
    UNIQUE (project_id, method, host, path)
);

CREATE INDEX IF NOT EXISTS idx_assets_project   ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_vulns_project    ON vulnerabilities(project_id);
CREATE INDEX IF NOT EXISTS idx_vulns_severity   ON vulnerabilities(severity);
CREATE INDEX IF NOT EXISTS idx_vulns_status     ON vulnerabilities(status);
CREATE INDEX IF NOT EXISTS idx_traffic_host     ON network_traffic(host);
CREATE INDEX IF NOT EXISTS idx_tasks_project    ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_targets_project ON project_targets(project_id, status);
CREATE INDEX IF NOT EXISTS idx_engagements_project ON engagements(project_id);
CREATE INDEX IF NOT EXISTS idx_scope_engagement ON scope_rules_v2(engagement_id);
CREATE INDEX IF NOT EXISTS idx_ack_engagement ON scope_acknowledgments(engagement_id, created_at);
CREATE INDEX IF NOT EXISTS idx_capability_project ON capability_tokens(project_id, status);
CREATE INDEX IF NOT EXISTS idx_capability_digest ON capability_tokens(token_digest);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_events_execution ON execution_events(execution_id, id);
CREATE INDEX IF NOT EXISTS idx_artifacts_execution ON artifacts(execution_id);
CREATE INDEX IF NOT EXISTS idx_playbook_runs_project ON playbook_runs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_playbook_steps_run ON playbook_steps(run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_hypotheses_project ON hypotheses(project_id, status);
CREATE INDEX IF NOT EXISTS idx_experiments_hypothesis ON experiments(hypothesis_id);
CREATE INDEX IF NOT EXISTS idx_reviews_finding ON finding_reviews(vulnerability_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_pack ON knowledge_documents(pack_id, pack_version);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(document_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_feedback_project ON research_feedback(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_profile ON research_memory(profile_id, active);
CREATE INDEX IF NOT EXISTS idx_memory_suggestions_status ON memory_suggestions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_endpoints_project ON endpoints(project_id, host, method);
CREATE INDEX IF NOT EXISTS idx_endpoints_host ON endpoints(host, path);
CREATE INDEX IF NOT EXISTS idx_model_providers_enabled ON model_providers(enabled);
