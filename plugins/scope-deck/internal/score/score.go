package score

import (
	"fmt"
	"math"
	"strings"

	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/model"
)

type Inputs struct {
	Profile   model.HunterProfile
	Program   model.Program
	Signals   []string
	Changes   []string
	Policies  []string
}

func Score(program model.Program, input *Inputs) model.TargetScore {
	contrib := map[string]int{}
	negative := map[string]int{}
	notes := []string{}
	signals := []string{}
	inference := []string{}

	freshness := freshnessScore(program.LastSourceUpdate, program.LastConfirmed)
	contrib["freshness"] = freshness
	if freshness > 0 { notes = append(notes, "Recent source activity found") }

	changeScore := clamp(program.ScopeSize/2 + len(strings.Fields(program.WhyNow))*4)
	contrib["recent_changes"] = changeScore
	if program.WhyNow != "" { signals = append(signals, program.WhyNow) }

	skill := skillMatch(program, input)
	contrib["skill_match"] = skill

	scopeQuality := clamp(20 + program.ScopeSize/2)
	if program.ScopeState == string(model.ScopeOfficialInScope) || program.ScopeState == string(model.ScopeOfficialVDP) {
		scopeQuality += 10
	}
	contrib["scope_quality"] = scopeQuality

	policy := policyScore(program)
	contrib["policy_clarity"] = policy

	reward := rewardScore(program)
	contrib["reward"] = reward

	surface := clamp(len(strings.Fields(program.BestAttackSurface)) * 4)
	contrib["surface_diversity"] = surface

	setup := setupScore(program.SetupDifficulty, program.AccountRequired)
	contrib["setup_accessibility"] = setup

	competition := competitionPenalty(program.Metadata)
	negative["competition"] = competition

	stability := stabilityScore(program)
	contrib["historical_stability"] = stability

	total := 0
	for _, v := range contrib { total += v }
	for _, v := range negative { total -= v }
	total = clamp(total)
	confidence := confidenceScore(program, input)

	if input == nil && program.OpportunityScore > 0 {
		total = program.OpportunityScore
	}

	if strings.Contains(strings.ToLower(stringValue(program.Metadata, "authority_label")), "community") {
		inference = append(inference, "community-discovered and not officially authorized")
	}

	return model.TargetScore{
		OpportunityScore: total,
		DataConfidence: confidence,
		Selected: total >= 70,
		Contributors: contrib,
		Negative: negative,
		Notes: notes,
		Signals: signals,
		Inference: inference,
	}
}

func freshnessScore(lastSourceUpdate, lastConfirmed string) int {
	if lastSourceUpdate == "" { return 0 }
	if len(lastSourceUpdate) >= 10 && len(lastConfirmed) >= 10 && lastSourceUpdate[:10] == lastConfirmed[:10] {
		return 12
	}
	return 22
}

func skillMatch(program model.Program, input *Inputs) int {
	if input == nil { return 10 }
	score := 0
	tech := strings.ToLower(stringValue(program.Metadata, "technology"))
	for _, pref := range input.Profile.PreferredTechnologies {
		if strings.Contains(tech, strings.ToLower(pref)) { score += 10; break }
	}
	for _, pref := range input.Profile.PreferredVulnClasses {
		if strings.Contains(strings.ToLower(stringValue(program.Metadata, "vuln_focus")), strings.ToLower(pref)) {
			score += 12
			break
		}
	}
	if input.Profile.SourceReviewInterest && strings.Contains(strings.ToLower(program.BestAttackSurface), "source") {
		score += 8
	}
	if input.Profile.WebAPIInterest && strings.Contains(strings.ToLower(program.BestAttackSurface), "api") {
		score += 8
	}
	return clamp(score)
}

func policyScore(program model.Program) int {
	score := 12
	switch strings.ToLower(program.ScopeState) {
	case string(model.ScopeOfficialInScope), string(model.ScopeOfficialVDP):
		score += 18
	case string(model.ScopeCommunityAttributed):
		score += 4
	case string(model.ScopeLikelyOwned):
		score += 8
	case string(model.ScopeRequiresPolicyConfirm):
		score -= 4
	case string(model.ScopeUnknown), string(model.ScopeStale):
		score -= 8
	}
	if !program.AccountRequired {
		score += 8
	}
	if program.RewardMax > 0 {
		score += 6
	}
	return clamp(score)
}

func rewardScore(program model.Program) int {
	switch {
	case program.RewardMax >= 5000:
		return 18
	case program.RewardMax > 0:
		return 12
	default:
		return 4
	}
}

func setupScore(setup string, accountRequired bool) int {
	score := 14
	switch strings.ToLower(setup) {
	case "easy":
		score += 10
	case "moderate":
		score += 6
	case "hard":
		score -= 6
	}
	if accountRequired {
		score -= 6
	}
	return clamp(score)
}

func competitionPenalty(meta map[string]any) int {
	if meta == nil { return 0 }
	if v, ok := meta["competition_hint"].(string); ok {
		switch strings.ToLower(v) {
		case "high":
			return 12
		case "medium":
			return 6
		}
	}
	return 0
}

func stabilityScore(program model.Program) int {
	score := 10
	if program.Metadata != nil {
		if v, ok := program.Metadata["stability"].(string); ok {
			switch strings.ToLower(v) {
			case "stable":
				score += 12
			case "volatile":
				score -= 6
			}
		}
	}
	return clamp(score)
}

func confidenceScore(program model.Program, input *Inputs) int {
	conf := program.DataConfidence
	if conf == 0 { conf = 40 }
	if input != nil && len(input.Signals) > 0 { conf += 6 }
	if program.RawSourceSnapshot != "" { conf += 8 }
	return int(math.Min(100, float64(conf)))
}

func clamp(v int) int {
	if v < 0 { return 0 }
	if v > 100 { return 100 }
	return v
}

func stringValue(meta map[string]any, key string) string {
	if meta == nil {
		return ""
	}
	if v, ok := meta[key]; ok && v != nil {
		return strings.TrimSpace(fmt.Sprint(v))
	}
	return ""
}
