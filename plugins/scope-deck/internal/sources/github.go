package sources

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/model"
)

type githubFile struct{ dataset string }

func (g githubFile) Name() string { return "github-file" }
func (g githubFile) Kind() string { return "github" }
func (g githubFile) Authority() string { return string(model.SourceCommunityMaintained) }

func (g githubFile) Parse(r io.Reader, sourceURL string) ([]Record, error) {
	blob, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(string(blob))
	if strings.HasPrefix(text, "{") || strings.HasPrefix(text, "[") {
		var payload any
		if err := json.Unmarshal(blob, &payload); err != nil {
			return nil, err
		}
		return parseAnyJSON(payload, sourceURL, g.dataset), nil
	}
	// Fall back to CSV-ish line entries.
	lines := strings.Split(text, "\n")
	records := make([]Record, 0, len(lines))
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		m := map[string]any{
			"source_name": "github-file",
			"source_slug": "github-file",
			"source_kind": "github",
			"source_record_id": line,
			"name": line,
			"program": line,
			"best_attack_surface": "web",
			"scope_state": string(model.ScopeCommunityAttributed),
			"setup_difficulty": "moderate",
			"source_record_url": sourceURL,
			"last_source_update": "",
			"first_seen": "",
			"last_seen": "",
			"last_confirmed": "",
			"reward_status": "unknown",
			"opportunity_score": 40 + (i % 10),
			"confidence": 45,
			"reward_currency": "USD",
		}
		records = append(records, fromMap(m, sourceURL, model.SourceCommunityMaintained))
	}
	return records, nil
}

func parseAnyJSON(payload any, sourceURL, dataset string) []Record {
	switch v := payload.(type) {
	case map[string]any:
		if programs, ok := v["programs"].([]any); ok {
			records := make([]Record, 0, len(programs))
			for _, item := range programs {
				if m, ok := item.(map[string]any); ok {
					records = append(records, fromMap(normalizeMap(m, dataset), sourceURL, sourceAuthorityForDataset(dataset)))
				}
			}
			return records
		}
	case []any:
		records := make([]Record, 0, len(v))
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				records = append(records, fromMap(normalizeMap(m, dataset), sourceURL, sourceAuthorityForDataset(dataset)))
			}
		}
		return records
	}
	return nil
}

func normalizeMap(m map[string]any, dataset string) map[string]any {
	out := map[string]any{}
	for k, v := range m {
		out[strings.ToLower(strings.ReplaceAll(k, " ", "_"))] = v
	}
	out["source_name"] = dataset
	out["source_slug"] = normalizeSlug(dataset)
	out["source_kind"] = "github"
	out["source_record_id"] = firstString(
		safeString(out["source_record_id"]),
		safeString(out["id"]),
		safeString(out["program"]),
		safeString(out["name"]),
	)
	out["source_record_url"] = safeString(out["source_record_url"])
	if out["source_record_url"] == "" {
		out["source_record_url"] = dataset
	}
	return out
}

func sourceAuthorityForDataset(dataset string) model.SourceAuthority {
	if strings.Contains(strings.ToLower(dataset), "gov") {
		return model.SourceVerifiedPublic
	}
	return model.SourceCommunityMaintained
}

func safeString(v any) string {
	if v == nil { return "" }
	return strings.TrimSpace(strings.Trim(fmt.Sprint(v), "\""))
}
