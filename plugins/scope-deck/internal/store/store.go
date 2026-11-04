package store

import (
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/model"
	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/score"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

const parserVersion = "1.0.0"

type Store struct {
	DB *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite3", path+"?_foreign_keys=on&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		_ = db.Close()
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{DB: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) Counts() (programs, sources int, err error) {
	if err = s.DB.QueryRow(`SELECT count(*) FROM programs WHERE active=1`).Scan(&programs); err != nil {
		return
	}
	err = s.DB.QueryRow(`SELECT count(*) FROM sources`).Scan(&sources)
	return
}

func (s *Store) migrate() error {
	_, err := s.DB.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`)
	if err != nil {
		return err
	}
	files, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)
	for _, file := range files {
		version := strings.TrimSuffix(filepath.Base(file), ".sql")
		if hasMigration, _ := s.hasMigration(version); hasMigration {
			continue
		}
		contents, err := fs.ReadFile(migrationsFS, file)
		if err != nil {
			return err
		}
		tx, err := s.DB.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(contents)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %s: %w", version, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)`, version, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) hasMigration(version string) (bool, error) {
	row := s.DB.QueryRow(`SELECT 1 FROM schema_migrations WHERE version = ?`, version)
	var one int
	if err := row.Scan(&one); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func newID() string {
	var b [16]byte
	rand.New(rand.NewSource(time.Now().UnixNano())).Read(b[:])
	sum := sha256.Sum256(b[:])
	return hex.EncodeToString(sum[:16])
}

type ProgramFilter struct {
	Query             string
	Platform          string
	Authority         string
	ScopeState        string
	MinOpportunity    int
	MaxOpportunity    int
	RewardRequired    bool
	Limit             int
	ExcludeIndustries []string
}

type DrawRequest struct {
	Mode            model.DrawMode `json:"mode"`
	HunterProfileID string         `json:"hunter_profile_id"`
	ExcludeIDs      []string       `json:"exclude_ids"`
	Limit           int            `json:"limit"`
}

type DrawResult struct {
	Program  ProgramView       `json:"program"`
	Score    model.TargetScore `json:"score"`
	Reason   []string          `json:"reason"`
	Excluded []string          `json:"excluded"`
	Mode     model.DrawMode    `json:"mode"`
}

type ProgramView struct {
	model.Program
	PlatformName string            `json:"platform_name"`
	Sources      []model.Source    `json:"sources"`
	Signals      []map[string]any  `json:"signals"`
	Policies     []map[string]any  `json:"policies"`
	Assets       []map[string]any  `json:"assets"`
	Changes      []map[string]any  `json:"changes"`
	Score        model.TargetScore `json:"score"`
}

func (s *Store) UpsertSource(source model.Source, rawURL string) (model.Source, error) {
	if source.ID == "" {
		source.ID = newID()
	}
	if source.CreatedAt.IsZero() {
		source.CreatedAt = time.Now().UTC()
	}
	source.UpdatedAt = time.Now().UTC()
	_, err := s.DB.Exec(`
INSERT INTO sources(id, name, slug, kind, authority, source_url, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(slug) DO UPDATE SET
  name=excluded.name, kind=excluded.kind, authority=excluded.authority,
  source_url=excluded.source_url, updated_at=excluded.updated_at`,
		source.ID, source.Name, source.Slug, source.Kind, source.Authority, rawURL, source.CreatedAt.Format(time.RFC3339Nano), source.UpdatedAt.Format(time.RFC3339Nano))
	if err != nil {
		return source, err
	}
	row := s.DB.QueryRow(`SELECT id,created_at,updated_at FROM sources WHERE slug=?`, source.Slug)
	var created, updated string
	if err := row.Scan(&source.ID, &created, &updated); err != nil {
		return source, err
	}
	source.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	source.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return source, nil
}

func (s *Store) Sources() ([]model.Source, error) {
	rows, err := s.DB.Query(`SELECT id, name, slug, kind, authority, source_url, created_at, updated_at FROM sources ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Source
	for rows.Next() {
		var src model.Source
		var created, updated string
		if err := rows.Scan(&src.ID, &src.Name, &src.Slug, &src.Kind, &src.Authority, &src.SourceURL, &created, &updated); err != nil {
			return nil, err
		}
		src.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		src.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		out = append(out, src)
	}
	return out, rows.Err()
}

func (s *Store) UpsertProgram(p model.Program) (model.Program, error) {
	if p.ID == "" {
		p.ID = newID()
	}
	if p.CreatedAt.IsZero() {
		p.CreatedAt = time.Now().UTC()
	}
	p.UpdatedAt = time.Now().UTC()
	meta, _ := json.Marshal(p.Metadata)
	_, err := s.DB.Exec(`
INSERT INTO programs(
 id, platform_id, source_id, source_record_id, name, slug, reward_status,
 opportunity_score, data_confidence, why_selected, why_now, best_attack_surface,
 setup_difficulty, scope_state, scope_size, country, industry, account_required,
 reward_min, reward_max, reward_currency, last_source_update, first_seen,
 last_seen, last_confirmed, parser_version, raw_source_snapshot, active,
 metadata_json, source_url, source_record_url, created_at, updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(source_id, source_record_id) DO UPDATE SET
 platform_id=excluded.platform_id,
 name=excluded.name, slug=excluded.slug, reward_status=excluded.reward_status,
 opportunity_score=excluded.opportunity_score, data_confidence=excluded.data_confidence,
 why_selected=excluded.why_selected, why_now=excluded.why_now,
 best_attack_surface=excluded.best_attack_surface, setup_difficulty=excluded.setup_difficulty,
 scope_state=excluded.scope_state, scope_size=excluded.scope_size, country=excluded.country,
 industry=excluded.industry, account_required=excluded.account_required,
 reward_min=excluded.reward_min, reward_max=excluded.reward_max,
 reward_currency=excluded.reward_currency, last_source_update=excluded.last_source_update,
 first_seen=excluded.first_seen, last_seen=excluded.last_seen, last_confirmed=excluded.last_confirmed,
 parser_version=excluded.parser_version, raw_source_snapshot=excluded.raw_source_snapshot,
 active=excluded.active, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at,
 source_url=excluded.source_url, source_record_url=excluded.source_record_url`,
		p.ID, nullIfEmpty(p.PlatformID), p.SourceID, p.SourceRecordID, p.Name, p.Slug,
		p.RewardStatus, p.OpportunityScore, p.DataConfidence, p.WhySelected, p.WhyNow,
		p.BestAttackSurface, p.SetupDifficulty, p.ScopeState, p.ScopeSize, p.Country, p.Industry,
		boolToInt(p.AccountRequired), p.RewardMin, p.RewardMax, p.RewardCurrency, p.LastSourceUpdate,
		p.FirstSeen, p.LastSeen, p.LastConfirmed, p.ParserVersion, p.RawSourceSnapshot, boolToInt(p.Active),
		string(meta), p.SourceURL, p.SourceRecordURL, p.CreatedAt.Format(time.RFC3339Nano), p.UpdatedAt.Format(time.RFC3339Nano))
	if err != nil {
		return p, err
	}
	var created, updated string
	if err := s.DB.QueryRow(`SELECT id,created_at,updated_at FROM programs WHERE source_id=? AND source_record_id=?`, p.SourceID, p.SourceRecordID).Scan(&p.ID, &created, &updated); err != nil {
		return p, err
	}
	p.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return p, nil
}

func nullIfEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func intToBool(v int) bool { return v != 0 }

func (s *Store) Programs(filter ProgramFilter) ([]ProgramView, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	base := `
SELECT p.id, p.platform_id, p.source_id, p.source_record_id, p.name, p.slug, p.reward_status,
       p.opportunity_score, p.data_confidence, p.why_selected, p.why_now, p.best_attack_surface,
       p.setup_difficulty, p.scope_state, p.scope_size, p.country, p.industry, p.account_required,
       p.reward_min, p.reward_max, p.reward_currency, p.last_source_update, p.first_seen,
       p.last_seen, p.last_confirmed, p.parser_version, p.raw_source_snapshot, p.active,
       p.metadata_json, p.source_url, p.source_record_url, p.created_at, p.updated_at,
       coalesce(pl.name, '') AS platform_name
FROM programs p
LEFT JOIN platforms pl ON pl.id = p.platform_id`
	where := []string{"p.active = 1"}
	args := []any{}
	if expression := searchExpression(filter.Query); expression != "" {
		base += ` JOIN program_search_fts fts ON fts.program_id = p.id`
		where = append(where, `program_search_fts MATCH ?`)
		args = append(args, expression)
	}
	if filter.Platform != "" {
		where = append(where, `lower(coalesce(pl.slug,'')) = lower(?)`)
		args = append(args, filter.Platform)
	}
	if filter.Authority != "" {
		where = append(where, `lower(coalesce(p.metadata_json,'')) LIKE ?`)
		args = append(args, "%"+strings.ToLower(filter.Authority)+"%")
	}
	if filter.ScopeState != "" {
		where = append(where, `lower(p.scope_state) = lower(?)`)
		args = append(args, filter.ScopeState)
	}
	if filter.MinOpportunity > 0 {
		where = append(where, `p.opportunity_score >= ?`)
		args = append(args, filter.MinOpportunity)
	}
	if filter.MaxOpportunity > 0 {
		where = append(where, `p.opportunity_score <= ?`)
		args = append(args, filter.MaxOpportunity)
	}
	if filter.RewardRequired {
		where = append(where, `p.reward_max > 0`)
	}
	sqlStmt := base + " WHERE " + strings.Join(where, " AND ") + " ORDER BY p.opportunity_score DESC, p.updated_at DESC LIMIT ?"
	args = append(args, limit)
	rows, err := s.DB.Query(sqlStmt, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProgramView
	for rows.Next() {
		p, err := scanProgramView(rows)
		if err != nil {
			return nil, err
		}
		p.Score = score.Score(p.Program, nil)
		out = append(out, p)
	}
	return out, rows.Err()
}

func searchExpression(query string) string {
	parts := strings.Fields(query)
	for index, part := range parts {
		parts[index] = `"` + strings.ReplaceAll(part, `"`, `""`) + `"*`
	}
	return strings.Join(parts, " AND ")
}

func scanProgramView(rows *sql.Rows) (ProgramView, error) {
	var p ProgramView
	var metadataJSON string
	var active, accountRequired int
	var createdAt, updatedAt string
	var sourceURL, sourceRecordURL string
	err := rows.Scan(&p.ID, &p.PlatformID, &p.SourceID, &p.SourceRecordID, &p.Name, &p.Slug,
		&p.RewardStatus, &p.OpportunityScore, &p.DataConfidence, &p.WhySelected, &p.WhyNow,
		&p.BestAttackSurface, &p.SetupDifficulty, &p.ScopeState, &p.ScopeSize, &p.Country,
		&p.Industry, &accountRequired, &p.RewardMin, &p.RewardMax, &p.RewardCurrency, &p.LastSourceUpdate,
		&p.FirstSeen, &p.LastSeen, &p.LastConfirmed, &p.ParserVersion, &p.RawSourceSnapshot,
		&active, &metadataJSON, &sourceURL, &sourceRecordURL, &createdAt, &updatedAt, &p.PlatformName)
	if err != nil {
		return p, err
	}
	p.Active = intToBool(active)
	p.AccountRequired = intToBool(accountRequired)
	_ = json.Unmarshal([]byte(metadataJSON), &p.Metadata)
	p.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
	p.SourceURL = sourceURL
	p.SourceRecordURL = sourceRecordURL
	return p, nil
}

func (s *Store) Program(id string) (ProgramView, error) {
	row := s.DB.QueryRow(`
SELECT p.id, p.platform_id, p.source_id, p.source_record_id, p.name, p.slug, p.reward_status,
       p.opportunity_score, p.data_confidence, p.why_selected, p.why_now, p.best_attack_surface,
       p.setup_difficulty, p.scope_state, p.scope_size, p.country, p.industry, p.account_required,
       p.reward_min, p.reward_max, p.reward_currency, p.last_source_update, p.first_seen,
       p.last_seen, p.last_confirmed, p.parser_version, p.raw_source_snapshot, p.active,
       p.metadata_json, p.source_url, p.source_record_url, p.created_at, p.updated_at,
       coalesce(pl.name, '') AS platform_name
FROM programs p
LEFT JOIN platforms pl ON pl.id = p.platform_id
WHERE p.id = ?`, id)
	var p ProgramView
	var metadataJSON string
	var active, accountRequired int
	var createdAt, updatedAt string
	var sourceURL, sourceRecordURL string
	err := row.Scan(&p.ID, &p.PlatformID, &p.SourceID, &p.SourceRecordID, &p.Name, &p.Slug,
		&p.RewardStatus, &p.OpportunityScore, &p.DataConfidence, &p.WhySelected, &p.WhyNow,
		&p.BestAttackSurface, &p.SetupDifficulty, &p.ScopeState, &p.ScopeSize, &p.Country,
		&p.Industry, &accountRequired, &p.RewardMin, &p.RewardMax, &p.RewardCurrency, &p.LastSourceUpdate,
		&p.FirstSeen, &p.LastSeen, &p.LastConfirmed, &p.ParserVersion, &p.RawSourceSnapshot,
		&active, &metadataJSON, &sourceURL, &sourceRecordURL, &createdAt, &updatedAt, &p.PlatformName)
	if err != nil {
		return p, err
	}
	p.Active = intToBool(active)
	p.AccountRequired = intToBool(accountRequired)
	_ = json.Unmarshal([]byte(metadataJSON), &p.Metadata)
	p.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
	p.SourceURL = sourceURL
	p.SourceRecordURL = sourceRecordURL
	if p.Sources, err = s.sourcesForProgram(id); err != nil {
		return p, err
	}
	if p.Signals, err = s.signalsForProgram(id); err != nil {
		return p, err
	}
	if p.Policies, err = s.policiesForProgram(id); err != nil {
		return p, err
	}
	if p.Assets, err = s.assetsForProgram(id); err != nil {
		return p, err
	}
	if p.Changes, err = s.changesForProgram(id); err != nil {
		return p, err
	}
	return p, nil
}

func (s *Store) sourcesForProgram(programID string) ([]model.Source, error) {
	rows, err := s.DB.Query(`SELECT DISTINCT s.id,s.name,s.slug,s.kind,s.authority,s.source_url,s.created_at,s.updated_at FROM sources s JOIN programs p ON p.source_id=s.id WHERE p.id=?`, programID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Source
	for rows.Next() {
		var item model.Source
		var created, updated string
		if err := rows.Scan(&item.ID, &item.Name, &item.Slug, &item.Kind, &item.Authority, &item.SourceURL, &created, &updated); err != nil {
			return nil, err
		}
		item.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		item.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) signalsForProgram(programID string) ([]map[string]any, error) {
	return s.queryMaps(`SELECT signal_type,summary,weight,source_url,confidence,first_seen,last_seen,confirmed_at FROM target_signals WHERE program_id=? ORDER BY weight DESC, created_at DESC`, programID,
		[]string{"signal_type", "summary", "weight", "source_url", "confidence", "first_seen", "last_seen", "confirmed_at"})
}

func (s *Store) policiesForProgram(programID string) ([]map[string]any, error) {
	return s.queryMaps(`SELECT policy_url,policy_text,policy_hash,status,first_seen,last_seen,last_confirmed FROM program_policies WHERE program_id=? ORDER BY updated_at DESC`, programID,
		[]string{"policy_url", "policy_text", "policy_hash", "status", "first_seen", "last_seen", "last_confirmed"})
}

func (s *Store) assetsForProgram(programID string) ([]map[string]any, error) {
	return s.queryMaps(`SELECT asset_type,value,scope_state,details_json,confidence,first_seen,last_seen,last_confirmed FROM scope_assets WHERE program_id=? ORDER BY asset_type,value`, programID,
		[]string{"asset_type", "value", "scope_state", "details_json", "confidence", "first_seen", "last_seen", "last_confirmed"})
}

func (s *Store) changesForProgram(programID string) ([]map[string]any, error) {
	return s.queryMaps(`SELECT change_type,summary,source_url,confidence,first_seen,last_seen,confirmed_at FROM program_changes WHERE program_id=? ORDER BY created_at DESC`, programID,
		[]string{"change_type", "summary", "source_url", "confidence", "first_seen", "last_seen", "confirmed_at"})
}

func (s *Store) queryMaps(query, programID string, keys []string) ([]map[string]any, error) {
	rows, err := s.DB.Query(query, programID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		values := make([]any, len(keys))
		pointers := make([]any, len(keys))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		item := map[string]any{}
		for i, key := range keys {
			if blob, ok := values[i].([]byte); ok {
				item[key] = string(blob)
			} else {
				item[key] = values[i]
			}
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) StartSourceSync(id, sourceID, parserVersion string) error {
	_, err := s.DB.Exec(`INSERT INTO source_syncs(id,source_id,status,parser_version,records_seen,records_upserted,started_at,created_at) VALUES(?,?,'running',?,0,0,?,?)`, id, sourceID, parserVersion, now(), now())
	return err
}

func (s *Store) FinishSourceSync(id, status string, seen, upserted int, message string) error {
	_, err := s.DB.Exec(`UPDATE source_syncs SET status=?,records_seen=?,records_upserted=?,error=?,finished_at=? WHERE id=?`, status, seen, upserted, message, now(), id)
	return err
}

func (s *Store) AddProgramSnapshot(programID, sourceSyncID, sourceRecordID, rawSnapshot string, confidence int, parserVersion string, firstSeen, lastSeen, lastConfirmed time.Time) error {
	sum := sha256.Sum256([]byte(rawSnapshot))
	_, err := s.DB.Exec(`INSERT INTO program_snapshots(id, program_id, source_sync_id, source_record_id, source_snapshot, source_snapshot_hash, first_seen, last_seen, last_confirmed, confidence, parser_version, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		newID(), programID, sourceSyncID, sourceRecordID, rawSnapshot, hex.EncodeToString(sum[:]),
		firstSeen.Format(time.RFC3339Nano), lastSeen.Format(time.RFC3339Nano), lastConfirmed.Format(time.RFC3339Nano), confidence, parserVersion, now())
	return err
}

func (s *Store) ReplaceProgramDetails(programID, sourceID, sourceRecordID, policyURL, policyText string, assets, signals, changes []map[string]any, parserVersion string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"program_policies", "scope_assets", "target_signals", "program_changes"} {
		if _, err := tx.Exec(`DELETE FROM `+table+` WHERE program_id=? AND source_id=?`, programID, sourceID); err != nil {
			return err
		}
	}
	stamp := now()
	if strings.TrimSpace(policyURL) != "" || strings.TrimSpace(policyText) != "" {
		digest := sha256.Sum256([]byte(policyText))
		_, err = tx.Exec(`INSERT INTO program_policies(id,program_id,source_id,policy_url,policy_text,policy_hash,status,first_seen,last_seen,last_confirmed,created_at,updated_at) VALUES(?,?,?,?,?,?,'current',?,?,?,?,?)`,
			newID(), programID, sourceID, policyURL, policyText, hex.EncodeToString(digest[:]), stamp, stamp, stamp, stamp, stamp)
		if err != nil {
			return err
		}
	}
	for _, item := range assets {
		assetType := firstMapString(item, "asset_type", "type")
		value := firstMapString(item, "value", "asset")
		if assetType == "" || value == "" {
			continue
		}
		details, _ := json.Marshal(item)
		_, err = tx.Exec(`INSERT INTO scope_assets(id,program_id,source_id,source_record_id,asset_type,value,scope_state,details_json,first_seen,last_seen,last_confirmed,confidence,parser_version,raw_source_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			newID(), programID, sourceID, sourceRecordID, assetType, value, defaultMapString(item, "scope_state", defaultMapString(item, "state", "unknown")), string(details), stamp, stamp, stamp, mapInt(item["confidence"]), parserVersion, string(details), stamp, stamp)
		if err != nil {
			return err
		}
	}
	for _, item := range signals {
		summary := firstMapString(item, "summary", "description")
		if summary == "" {
			continue
		}
		raw, _ := json.Marshal(item)
		_, err = tx.Exec(`INSERT INTO target_signals(id,program_id,signal_type,summary,weight,source_id,source_record_id,source_url,first_seen,last_seen,confirmed_at,confidence,parser_version,raw_source_snapshot,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			newID(), programID, defaultMapString(item, "signal_type", "general"), summary, mapInt(item["weight"]), sourceID, sourceRecordID, firstMapString(item, "source_url"), stamp, stamp, stamp, mapInt(item["confidence"]), parserVersion, string(raw), stamp)
		if err != nil {
			return err
		}
	}
	for _, item := range changes {
		summary := firstMapString(item, "summary", "description")
		if summary == "" {
			continue
		}
		raw, _ := json.Marshal(item)
		_, err = tx.Exec(`INSERT INTO program_changes(id,program_id,change_type,summary,source_id,source_record_id,source_url,first_seen,last_seen,confirmed_at,confidence,parser_version,raw_source_snapshot,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			newID(), programID, defaultMapString(item, "change_type", "updated"), summary, sourceID, sourceRecordID, firstMapString(item, "source_url"), stamp, stamp, stamp, mapInt(item["confidence"]), parserVersion, string(raw), stamp)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func firstMapString(item map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(fmt.Sprint(item[key])); value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func defaultMapString(item map[string]any, key, fallback string) string {
	if value := firstMapString(item, key); value != "" {
		return value
	}
	return fallback
}

func mapInt(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		var result int
		fmt.Sscanf(fmt.Sprint(value), "%d", &result)
		return result
	}
}

func (s *Store) UpsertHunterProfile(profile model.HunterProfile) (model.HunterProfile, error) {
	if profile.ID == "" {
		profile.ID = newID()
	}
	if profile.CreatedAt.IsZero() {
		profile.CreatedAt = time.Now().UTC()
	}
	profile.UpdatedAt = time.Now().UTC()
	data, _ := json.Marshal(profile)
	_, err := s.DB.Exec(`
INSERT INTO hunter_profiles(id, name, profile_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, profile_json=excluded.profile_json, updated_at=excluded.updated_at`,
		profile.ID, profile.Name, string(data), profile.CreatedAt.Format(time.RFC3339Nano), profile.UpdatedAt.Format(time.RFC3339Nano))
	return profile, err
}

func (s *Store) DefaultHunterProfile() (model.HunterProfile, error) {
	row := s.DB.QueryRow(`SELECT id, name, profile_json, created_at, updated_at FROM hunter_profiles ORDER BY created_at LIMIT 1`)
	var profile model.HunterProfile
	var blob, created, updated string
	if err := row.Scan(&profile.ID, &profile.Name, &blob, &created, &updated); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			profile = model.HunterProfile{
				Name:                  "Main Hunt",
				ExperienceLevel:       "beginner",
				PreferredVulnClasses:  []string{"access-control", "auth", "api"},
				PreferredTechnologies: []string{"web", "api", "wordpress"},
				WebAPIInterest:        true,
				SourceReviewInterest:  true,
				AvailableHours:        6,
				AccountSetupTolerance: "low",
				BlackBoxPreference:    "balanced",
				PreferredPlatforms:    []string{"HackerOne", "Bugcrowd", "Intigriti"},
				RewardRequirement:     "preferred",
				ToolsAvailable:        []string{"browser", "burp-like", "cli"},
				Weights:               map[string]float64{"freshness": 0.18, "changes": 0.18, "skill_match": 0.20, "policy_clarity": 0.14, "reward": 0.10, "competition": 0.10, "setup": 0.10, "stability": 0.10},
				CreatedAt:             time.Now().UTC(),
				UpdatedAt:             time.Now().UTC(),
			}
			return s.UpsertHunterProfile(profile)
		}
		return profile, err
	}
	_ = json.Unmarshal([]byte(blob), &profile)
	profile.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	profile.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return profile, nil
}

func (s *Store) UpsertPlatform(slug, name string) (string, error) {
	id := newID()
	_, err := s.DB.Exec(`INSERT INTO platforms(id, slug, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name`,
		id, slug, name, now())
	if err != nil {
		return "", err
	}
	row := s.DB.QueryRow(`SELECT id FROM platforms WHERE slug = ?`, slug)
	if err := row.Scan(&id); err != nil {
		return "", err
	}
	return id, nil
}

func (s *Store) SourceBySlug(slug string) (model.Source, error) {
	row := s.DB.QueryRow(`SELECT id, name, slug, kind, authority, source_url, created_at, updated_at FROM sources WHERE slug = ?`, slug)
	var src model.Source
	var created, updated string
	if err := row.Scan(&src.ID, &src.Name, &src.Slug, &src.Kind, &src.Authority, &src.SourceURL, &created, &updated); err != nil {
		return src, err
	}
	src.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	src.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return src, nil
}
