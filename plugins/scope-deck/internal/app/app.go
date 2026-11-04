package app

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/model"
	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/score"
	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/sources"
	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/store"
)

const Version = "0.1.0"

type Config struct {
	Home string
	DB   string
	Addr string
}

type App struct {
	Store  *store.Store
	Config Config
}

func Open(cfg Config) (*App, error) {
	if cfg.Home == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("resolve home directory: %w", err)
		}
		cfg.Home = filepath.Join(home, ".scopedeck")
	}
	if cfg.DB == "" {
		cfg.DB = filepath.Join(cfg.Home, "scopedeck.db")
	}
	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:8321"
	}
	st, err := store.Open(cfg.DB)
	if err != nil {
		return nil, err
	}
	app := &App{Store: st, Config: cfg}
	if err := app.seed(); err != nil {
		_ = st.Close()
		return nil, err
	}
	return app, nil
}

func (a *App) Close() error { return a.Store.Close() }

func (a *App) seed() error {
	profile, err := a.Store.DefaultHunterProfile()
	if err != nil {
		return err
	}
	_, err = a.Store.UpsertHunterProfile(profile)
	return err
}

func (a *App) Health() map[string]any {
	programs, sourcesCount, countErr := a.Store.Counts()
	return map[string]any{
		"state": func() string {
			if countErr != nil {
				return "degraded"
			}
			if sourcesCount == 0 {
				return "preview"
			}
			return "ready"
		}(),
		"version":  Version,
		"programs": programs,
		"sources":  sourcesCount,
	}
}

func (a *App) Programs(query string, limit int) ([]store.ProgramView, error) {
	return a.Store.Programs(store.ProgramFilter{Query: query, Limit: limit})
}

func (a *App) Program(id string) (store.ProgramView, error) {
	return a.Store.Program(id)
}

func (a *App) Search(q string, limit int) ([]store.ProgramView, error) {
	return a.Store.Programs(store.ProgramFilter{Query: q, Limit: limit})
}

func (a *App) Compare(ids []string) ([]store.ProgramView, error) {
	items := make([]store.ProgramView, 0, len(ids))
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			continue
		}
		p, err := a.Store.Program(id)
		if err != nil {
			continue
		}
		p.Score = score.Score(p.Program, &score.Inputs{})
		items = append(items, p)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].OpportunityScore > items[j].OpportunityScore })
	return items, nil
}

func (a *App) SyncSource(kind, sourceURL string) (map[string]any, error) {
	adapter, err := sources.New(kind)
	if err != nil {
		return nil, err
	}
	var records []sources.Record
	switch {
	case strings.HasPrefix(sourceURL, "http://") || strings.HasPrefix(sourceURL, "https://"):
		records, err = sources.LoadFromURL(sourceURL, adapter)
	default:
		records, err = sources.LoadFromPath(sourceURL, adapter)
	}
	if err != nil {
		return nil, err
	}
	sourceName, sourceSlug := adapter.Name(), strings.ReplaceAll(adapter.Name(), "_", "-")
	sourceKind, sourceAuthority := adapter.Kind(), adapter.Authority()
	if len(records) > 0 {
		if records[0].Source.Name != "" {
			sourceName = records[0].Source.Name
		}
		if records[0].Source.Slug != "" {
			sourceSlug = records[0].Source.Slug
		}
		if records[0].Source.Kind != "" {
			sourceKind = records[0].Source.Kind
		}
		if records[0].Source.Authority != "" {
			sourceAuthority = records[0].Source.Authority
		}
	}
	source, err := a.Store.UpsertSource(model.Source{
		Name:      sourceName,
		Slug:      sourceSlug,
		Kind:      sourceKind,
		Authority: sourceAuthority,
		SourceURL: sourceURL,
	}, sourceURL)
	if err != nil {
		return nil, err
	}
	syncID := fmt.Sprintf("sync_%d", time.Now().UnixNano())
	if err := a.Store.StartSourceSync(syncID, source.ID, sources.ParserVersion); err != nil {
		return nil, err
	}
	finished := false
	defer func() {
		if !finished {
			_ = a.Store.FinishSourceSync(syncID, "failed", len(records), 0, "sync interrupted")
		}
	}()
	upserted := 0
	for _, rec := range records {
		platformID := ""
		if strings.TrimSpace(rec.PlatformSlug) != "" {
			platformID, err = a.Store.UpsertPlatform(rec.PlatformSlug, rec.PlatformName)
			if err != nil {
				return nil, err
			}
		}
		prog := rec.Program
		prog.SourceID = source.ID
		prog.PlatformID = platformID
		prog.SourceURL = sourceURL
		prog.SourceRecordURL = sourceURL
		prog.ScopeState = defaultScopeState(prog.ScopeState, source.Authority)
		prog.OpportunityScore = clampScore(prog.OpportunityScore)
		prog.DataConfidence = clampScore(rec.Confidence)
		prog.RawSourceSnapshot = rec.RawSourceSnapshot
		prog.ParserVersion = rec.ParserVersion
		if prog.Metadata == nil {
			prog.Metadata = map[string]any{}
		}
		prog.Metadata["source_authority"] = source.Authority
		prog.Metadata["source_url"] = sourceURL
		prog.Metadata["platform_name"] = rec.PlatformName
		updated, err := a.Store.UpsertProgram(prog)
		if err != nil {
			return nil, err
		}
		if err := a.Store.AddProgramSnapshot(updated.ID, syncID, rec.SourceRecordID, rec.RawSourceSnapshot, rec.Confidence, rec.ParserVersion, rec.FirstSeen, rec.LastSeen, rec.LastConfirmed); err != nil {
			return nil, err
		}
		if err := a.Store.ReplaceProgramDetails(updated.ID, source.ID, rec.SourceRecordID, rec.PolicyURL, rec.PolicyText, rec.ScopeAssets, rec.Signals, rec.Changes, rec.ParserVersion); err != nil {
			return nil, err
		}
		upserted++
	}
	if err := a.Store.FinishSourceSync(syncID, "complete", len(records), upserted, ""); err != nil {
		return nil, err
	}
	finished = true
	return map[string]any{
		"source":           source,
		"records_seen":     len(records),
		"records_upserted": upserted,
		"sync_id":          syncID,
		"adapter":          adapter.Name(),
	}, nil
}

func (a *App) Draw(req store.DrawRequest) (store.DrawResult, error) {
	if !validDrawMode(req.Mode) {
		return store.DrawResult{}, fmt.Errorf("unknown draw mode %q", req.Mode)
	}
	profile, err := a.Store.DefaultHunterProfile()
	if err != nil {
		return store.DrawResult{}, err
	}
	items, err := a.Store.Programs(store.ProgramFilter{Limit: 500})
	if err != nil {
		return store.DrawResult{}, err
	}
	excluded := map[string]struct{}{}
	for _, id := range req.ExcludeIDs {
		excluded[id] = struct{}{}
	}
	seed := time.Now().UnixNano()
	if req.HunterProfileID != "" {
		seed += int64(len(req.HunterProfileID))
	}
	rng := rand.New(rand.NewSource(seed))
	type candidate struct {
		view   store.ProgramView
		score  model.TargetScore
		weight float64
		reason []string
	}
	cands := []candidate{}
	for _, item := range items {
		if _, blocked := excluded[item.ID]; blocked {
			continue
		}
		sc := score.Score(item.Program, &score.Inputs{Profile: profile})
		weight := math.Max(1, float64(sc.OpportunityScore)*(0.6+float64(sc.DataConfidence)/200))
		weight *= diversityFactor(req.Mode, item)
		reason := []string{
			item.WhySelected,
			item.WhyNow,
		}
		cands = append(cands, candidate{view: item, score: sc, weight: weight, reason: reason})
	}
	if len(cands) == 0 {
		return store.DrawResult{}, errors.New("no eligible programs")
	}
	total := 0.0
	for _, c := range cands {
		total += c.weight
	}
	pick := rng.Float64() * total
	running := 0.0
	chosen := cands[len(cands)-1]
	for _, c := range cands {
		running += c.weight
		if pick <= running {
			chosen = c
			break
		}
	}
	return store.DrawResult{
		Program:  chosen.view,
		Score:    chosen.score,
		Reason:   chosen.reason,
		Excluded: req.ExcludeIDs,
		Mode:     req.Mode,
	}, nil
}

func validDrawMode(mode model.DrawMode) bool {
	switch mode {
	case model.DrawFreshDrop, model.DrawQuietGold, model.DrawBeginnerEntry, model.DrawDeepDive,
		model.DrawWordPressWhitebox, model.DrawAPIHunter, model.DrawAccessControl,
		model.DrawMobileBackend, model.DrawGovernmentCVD, model.DrawWeekendHunt,
		model.DrawWildcardExplorer, model.DrawSurpriseMe:
		return true
	default:
		return false
	}
}

func diversityFactor(mode model.DrawMode, view store.ProgramView) float64 {
	base := 1.0
	switch mode {
	case model.DrawFreshDrop:
		if updated, err := time.Parse(time.RFC3339Nano, view.LastSourceUpdate); err == nil && time.Since(updated) <= 30*24*time.Hour {
			base = 1.35
		} else {
			base = 0.80
		}
	case model.DrawQuietGold:
		if strings.Contains(strings.ToLower(view.WhyNow), "low public activity") {
			base = 1.25
		}
	case model.DrawBeginnerEntry:
		if strings.EqualFold(view.SetupDifficulty, "easy") {
			base = 1.30
		}
	case model.DrawDeepDive:
		if view.ScopeSize >= 50 || strings.EqualFold(view.SetupDifficulty, "hard") {
			base = 1.25
		}
	case model.DrawWordPressWhitebox:
		if strings.Contains(strings.ToLower(view.BestAttackSurface), "wordpress") {
			base = 1.30
		}
	case model.DrawAPIHunter:
		if strings.Contains(strings.ToLower(view.BestAttackSurface), "api") {
			base = 1.30
		}
	case model.DrawGovernmentCVD:
		authority := strings.ToLower(fmt.Sprint(view.Metadata["authority_label"]))
		if strings.Contains(authority, "verified_public") || strings.Contains(strings.ToLower(view.Industry), "government") {
			base = 1.35
		}
	}
	return base
}

func clampScore(v int) int {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func defaultScopeState(current, authority string) string {
	if strings.TrimSpace(current) != "" {
		return current
	}
	switch authority {
	case string(model.SourceOfficialProgram), string(model.SourceOfficialPlatform), string(model.SourceOfficialVendor):
		return string(model.ScopeOfficialInScope)
	case string(model.SourceVerifiedPublic):
		return string(model.ScopeOfficialVDP)
	case string(model.SourceCommunityMaintained):
		return string(model.ScopeCommunityAttributed)
	case string(model.SourceInferred):
		return string(model.ScopeRequiresPolicyConfirm)
	default:
		return string(model.ScopeUnknown)
	}
}
