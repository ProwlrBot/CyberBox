package model

import "time"

type SourceAuthority string

const (
	SourceOfficialProgram    SourceAuthority = "official_program"
	SourceOfficialPlatform   SourceAuthority = "official_platform"
	SourceOfficialVendor     SourceAuthority = "official_vendor"
	SourceVerifiedPublic     SourceAuthority = "verified_public_sector"
	SourceCommunityMaintained SourceAuthority = "community_maintained"
	SourceInferred           SourceAuthority = "inferred"
	SourceUserProvided       SourceAuthority = "user_provided"
)

type ScopeState string

const (
	ScopeOfficialInScope       ScopeState = "officially_in_scope"
	ScopeOfficialOutOfScope    ScopeState = "officially_out_of_scope"
	ScopeOfficialVDP           ScopeState = "official_vdp"
	ScopeCommunityAttributed   ScopeState = "community_attributed"
	ScopeLikelyOwned           ScopeState = "likely_owned"
	ScopeRequiresPolicyConfirm ScopeState = "requires_policy_confirmation"
	ScopeUnknown               ScopeState = "unknown"
	ScopeStale                 ScopeState = "stale"
)

type Source struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Slug       string    `json:"slug"`
	Kind       string    `json:"kind"`
	Authority  string    `json:"authority"`
	SourceURL  string    `json:"source_url"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type SourceSync struct {
	ID               string    `json:"id"`
	SourceID         string    `json:"source_id"`
	Status           string    `json:"status"`
	ParserVersion    string    `json:"parser_version"`
	RecordsSeen      int       `json:"records_seen"`
	RecordsUpserted  int       `json:"records_upserted"`
	SourceSnapshotID string    `json:"source_snapshot_id"`
	Error            string    `json:"error"`
	StartedAt        time.Time `json:"started_at"`
	FinishedAt       time.Time `json:"finished_at"`
	CreatedAt        time.Time `json:"created_at"`
}

type Program struct {
	ID                 string         `json:"id"`
	PlatformID         string         `json:"platform_id"`
	SourceID           string         `json:"source_id"`
	SourceRecordID     string         `json:"source_record_id"`
	Name               string         `json:"name"`
	Slug               string         `json:"slug"`
	RewardStatus       string         `json:"reward_status"`
	OpportunityScore   int            `json:"opportunity_score"`
	DataConfidence     int            `json:"data_confidence"`
	WhySelected        string         `json:"why_selected"`
	WhyNow             string         `json:"why_now"`
	BestAttackSurface  string         `json:"best_attack_surface"`
	SetupDifficulty    string         `json:"setup_difficulty"`
	ScopeState         string         `json:"scope_state"`
	ScopeSize          int            `json:"scope_size"`
	Country            string         `json:"country"`
	Industry           string         `json:"industry"`
	AccountRequired    bool           `json:"account_required"`
	RewardMin          int            `json:"reward_min"`
	RewardMax          int            `json:"reward_max"`
	RewardCurrency     string         `json:"reward_currency"`
	LastSourceUpdate   string         `json:"last_source_update"`
	FirstSeen          string         `json:"first_seen"`
	LastSeen           string         `json:"last_seen"`
	LastConfirmed      string         `json:"last_confirmed"`
	ParserVersion      string         `json:"parser_version"`
	RawSourceSnapshot  string         `json:"raw_source_snapshot"`
	Active             bool           `json:"active"`
	Metadata           map[string]any `json:"metadata"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	Authority          string         `json:"authority"`
	SourceURL          string         `json:"source_url"`
	SourceRecordURL    string         `json:"source_record_url"`
}

type TargetScore struct {
	OpportunityScore int            `json:"opportunity_score"`
	DataConfidence   int            `json:"data_confidence"`
	Selected         bool           `json:"selected"`
	Contributors     map[string]int `json:"contributors"`
	Negative         map[string]int `json:"negative"`
	Notes            []string       `json:"notes"`
	Signals          []string       `json:"signals"`
	Inference        []string       `json:"inference"`
}

type HunterProfile struct {
	ID                    string         `json:"id"`
	Name                  string         `json:"name"`
	ExperienceLevel       string         `json:"experience_level"`
	PreferredVulnClasses   []string       `json:"preferred_vulnerability_classes"`
	PreferredTechnologies  []string       `json:"preferred_technologies"`
	WebAPIInterest        bool           `json:"web_api_interest"`
	MobileInterest        bool           `json:"mobile_interest"`
	SourceReviewInterest  bool           `json:"source_review_interest"`
	AvailableHours        float64        `json:"available_hours"`
	AccountSetupTolerance  string         `json:"account_setup_tolerance"`
	BlackBoxPreference     string         `json:"black_box_preference"`
	PreferredPlatforms     []string       `json:"preferred_platforms"`
	RewardRequirement      string         `json:"reward_requirement"`
	ExcludedIndustries     []string       `json:"excluded_industries"`
	ToolsAvailable        []string       `json:"tools_available"`
	Weights               map[string]float64 `json:"weights"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
}

type DrawMode string

const (
	DrawFreshDrop         DrawMode = "fresh-drop"
	DrawQuietGold         DrawMode = "quiet-gold"
	DrawBeginnerEntry     DrawMode = "beginner-entry"
	DrawDeepDive          DrawMode = "deep-dive"
	DrawWordPressWhitebox DrawMode = "wordpress-whitebox"
	DrawAPIHunter         DrawMode = "api-hunter"
	DrawAccessControl     DrawMode = "access-control"
	DrawMobileBackend     DrawMode = "mobile-backend"
	DrawGovernmentCVD     DrawMode = "government-cvd"
	DrawWeekendHunt       DrawMode = "weekend-hunt"
	DrawWildcardExplorer  DrawMode = "wildcard-explorer"
	DrawSurpriseMe        DrawMode = "surprise-me"
)
