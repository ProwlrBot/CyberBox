package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/model"
)

type Record struct {
	Source            model.Source     `json:"source"`
	Program           model.Program    `json:"program"`
	PlatformSlug      string           `json:"platform_slug"`
	PlatformName      string           `json:"platform_name"`
	PolicyURL         string           `json:"policy_url"`
	PolicyText        string           `json:"policy_text"`
	ScopeAssets       []map[string]any `json:"scope_assets"`
	ScopeRules        []map[string]any `json:"scope_rules"`
	ExclusionRules    []map[string]any `json:"exclusion_rules"`
	RewardTiers       []map[string]any `json:"reward_tiers"`
	Changes           []map[string]any `json:"changes"`
	Signals           []map[string]any `json:"signals"`
	RawSourceSnapshot string           `json:"raw_source_snapshot"`
	SourceRecordID    string           `json:"source_record_id"`
	FirstSeen         time.Time        `json:"first_seen"`
	LastSeen          time.Time        `json:"last_seen"`
	LastConfirmed     time.Time        `json:"last_confirmed"`
	Confidence        int              `json:"confidence"`
	ParserVersion     string           `json:"parser_version"`
}

type Adapter interface {
	Name() string
	Kind() string
	Authority() string
	Parse(r io.Reader, sourceURL string) ([]Record, error)
}

const ParserVersion = "1.0.0"
const maxSourceBytes = 32 << 20

func New(kind string) (Adapter, error) {
	switch kind {
	case "manual-json":
		return manualJSON{}, nil
	case "manual-csv":
		return manualCSV{}, nil
	case "github-file":
		return githubFile{}, nil
	case "arkadiyt/bounty-targets-data", "osamahamad/payout-targets-data", "kdairatchi/Gov_Scope":
		return githubFile{dataset: kind}, nil
	default:
		return nil, fmt.Errorf("unknown adapter %q", kind)
	}
}

func LoadFromPath(path string, adapter Adapter) ([]Record, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("source must be a regular file")
	}
	if info.Size() > maxSourceBytes {
		return nil, fmt.Errorf("source exceeds the 32 MiB limit")
	}
	return adapter.Parse(io.LimitReader(f, maxSourceBytes+1), path)
}

func LoadFromURL(rawURL string, adapter Adapter) ([]Record, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return nil, fmt.Errorf("remote sources must use an HTTPS URL without credentials")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !publicIP(ip) {
				return nil, fmt.Errorf("source host resolves to a private or reserved address")
			}
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("source host did not resolve")
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}
	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			if req.URL.Scheme != "https" || req.URL.Hostname() == "" || req.URL.User != nil {
				return fmt.Errorf("redirect target must be HTTPS without credentials")
			}
			return nil
		},
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ScopeDeck/"+ParserVersion)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("source fetch failed: %s", resp.Status)
	}
	if resp.ContentLength > maxSourceBytes {
		return nil, fmt.Errorf("source exceeds the 32 MiB limit")
	}
	limited := &io.LimitedReader{R: resp.Body, N: maxSourceBytes + 1}
	records, err := adapter.Parse(limited, rawURL)
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(io.Discard, limited); err != nil {
		return nil, err
	}
	if limited.N == 0 {
		return nil, fmt.Errorf("source exceeds the 32 MiB limit")
	}
	return records, nil
}

func publicIP(ip net.IP) bool {
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	reserved := []string{
		"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24",
		"198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4",
		"2001:db8::/32",
	}
	for _, cidr := range reserved {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return false
		}
	}
	return true
}

func normalizeSlug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "-")
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case r == '-' || r == '_' || r == '/' || r == '.':
			if !lastDash {
				b.WriteRune('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

func parseRFC3339Any(v string) time.Time {
	v = strings.TrimSpace(v)
	if v == "" {
		return time.Time{}
	}
	layouts := []string{time.RFC3339Nano, time.RFC3339, "2006-01-02", "2006/01/02"}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, v); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

func fromMap(m map[string]any, sourceURL string, authority model.SourceAuthority) Record {
	now := time.Now().UTC()
	name := safeString(m["name"])
	if name == "" {
		name = safeString(m["program"])
	}
	platformName := safeString(m["platform_name"])
	if platformName == "" {
		platformName = safeString(m["platform"])
	}
	sourceRecordID := safeString(m["source_record_id"])
	if sourceRecordID == "" {
		sourceRecordID = safeString(m["id"])
	}
	if sourceRecordID == "" {
		sourceRecordID = normalizeSlug(name + "-" + platformName)
	}
	platformSlug := normalizeSlug(safeString(m["platform_slug"]))
	if platformSlug == "" {
		platformSlug = normalizeSlug(platformName)
	}
	scopeState := safeString(m["scope_state"])
	if scopeState == "" {
		scopeState = string(model.ScopeUnknown)
	}
	rewardMax := intFromAny(m["reward_max"])
	rewardMin := intFromAny(m["reward_min"])
	confidence := intFromAny(m["confidence"])
	if confidence == 0 {
		confidence = 50
	}
	meta := map[string]any{}
	for k, v := range m {
		meta[k] = v
	}
	meta["authority_label"] = authority
	assets := mapsFromAny(m["scope_assets"])
	if len(assets) == 0 {
		assets = mapsFromAny(m["scope"])
	}
	return Record{
		Source: model.Source{
			Name:      safeString(m["source_name"]),
			Slug:      normalizeSlug(safeString(m["source_slug"])),
			Kind:      safeString(m["source_kind"]),
			Authority: string(authority),
			SourceURL: sourceURL,
			CreatedAt: now,
			UpdatedAt: now,
		},
		Program: model.Program{
			PlatformID:        "",
			SourceID:          "",
			SourceRecordID:    sourceRecordID,
			Name:              name,
			Slug:              normalizeSlug(name),
			RewardStatus:      safeString(m["reward_status"]),
			OpportunityScore:  intFromAny(m["opportunity_score"]),
			DataConfidence:    confidence,
			WhySelected:       safeString(m["why_selected"]),
			WhyNow:            safeString(m["why_now"]),
			BestAttackSurface: safeString(m["best_attack_surface"]),
			SetupDifficulty:   defaultString(safeString(m["setup_difficulty"]), "moderate"),
			ScopeState:        scopeState,
			ScopeSize:         intFromAny(m["scope_size"]),
			Country:           safeString(m["country"]),
			Industry:          safeString(m["industry"]),
			AccountRequired:   boolFromAny(m["account_required"]),
			RewardMin:         rewardMin,
			RewardMax:         rewardMax,
			RewardCurrency:    defaultString(safeString(m["reward_currency"]), "USD"),
			LastSourceUpdate:  defaultString(safeString(m["last_source_update"]), now.Format(time.RFC3339Nano)),
			FirstSeen:         defaultString(safeString(m["first_seen"]), now.Format(time.RFC3339Nano)),
			LastSeen:          defaultString(safeString(m["last_seen"]), now.Format(time.RFC3339Nano)),
			LastConfirmed:     defaultString(safeString(m["last_confirmed"]), now.Format(time.RFC3339Nano)),
			ParserVersion:     ParserVersion,
			RawSourceSnapshot: marshalAny(m),
			Active:            true,
			Metadata:          meta,
			SourceURL:         sourceURL,
			SourceRecordURL:   safeString(m["source_record_url"]),
		},
		PlatformSlug:      platformSlug,
		PlatformName:      platformName,
		PolicyURL:         safeString(m["policy_url"]),
		PolicyText:        safeString(m["policy_text"]),
		ScopeAssets:       assets,
		ScopeRules:        mapsFromAny(m["scope_rules"]),
		ExclusionRules:    mapsFromAny(m["exclusion_rules"]),
		RewardTiers:       mapsFromAny(m["reward_tiers"]),
		Changes:           mapsFromAny(m["changes"]),
		Signals:           mapsFromAny(m["signals"]),
		RawSourceSnapshot: marshalAny(m),
		SourceRecordID:    sourceRecordID,
		FirstSeen:         parseRFC3339Any(safeString(m["first_seen"])),
		LastSeen:          parseRFC3339Any(safeString(m["last_seen"])),
		LastConfirmed:     parseRFC3339Any(safeString(m["last_confirmed"])),
		Confidence:        confidence,
		ParserVersion:     ParserVersion,
	}
}

func mapsFromAny(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		if typed, valid := value.([]map[string]any); valid {
			return typed
		}
		return nil
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if typed, valid := item.(map[string]any); valid {
			result = append(result, typed)
		}
	}
	return result
}

func intFromAny(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case string:
		var n int
		fmt.Sscanf(x, "%d", &n)
		return n
	default:
		return 0
	}
}

func boolFromAny(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return strings.EqualFold(x, "true") || x == "1" || strings.EqualFold(x, "yes")
	case int:
		return x != 0
	default:
		return false
	}
}

func defaultString(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}

func marshalAny(v any) string {
	out, _ := json.Marshal(v)
	return string(out)
}
