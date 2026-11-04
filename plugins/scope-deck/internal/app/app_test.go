package app

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/model"
	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/store"
)

func TestManualSyncPersistsProgramAndScope(t *testing.T) {
	home := t.TempDir()
	source := filepath.Join(home, "programs.json")
	document := `{
  "source": {"name":"Interview targets","slug":"interview-targets","kind":"manual","authority":"user_provided"},
  "programs": [{
    "id":"acme", "name":"Acme Security", "platform":"Direct", "reward_status":"paid",
    "opportunity_score":82, "confidence":90, "scope_state":"officially_in_scope",
    "policy_url":"https://example.com/security", "policy_text":"Test only listed assets.",
    "scope":[{"type":"domain","value":"security.example.com","state":"officially_in_scope","confidence":95}],
    "signals":[{"signal_type":"freshness","summary":"Policy updated","weight":8,"confidence":90}],
    "changes":[{"change_type":"scope","summary":"API added","confidence":80}]
  }]
}`
	if err := os.WriteFile(source, []byte(document), 0o600); err != nil {
		t.Fatal(err)
	}

	a, err := Open(Config{Home: home})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	result, err := a.SyncSource("manual-json", source)
	if err != nil {
		t.Fatal(err)
	}
	if result["records_upserted"] != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}

	items, err := a.Search("Acme", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("got %d search results", len(items))
	}
	detail, err := a.Program(items[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Assets) != 1 || detail.Assets[0]["value"] != "security.example.com" {
		t.Fatalf("scope was not persisted: %#v", detail.Assets)
	}
	if len(detail.Policies) != 1 || len(detail.Signals) != 1 || len(detail.Changes) != 1 {
		t.Fatalf("details missing: policies=%d signals=%d changes=%d", len(detail.Policies), len(detail.Signals), len(detail.Changes))
	}

	if _, err := a.SyncSource("manual-json", source); err != nil {
		t.Fatal(err)
	}
	programs, sources, err := a.Store.Counts()
	if err != nil {
		t.Fatal(err)
	}
	if programs != 1 || sources != 1 {
		t.Fatalf("sync was not idempotent: programs=%d sources=%d", programs, sources)
	}
	if drawn, err := a.Draw(store.DrawRequest{Mode: model.DrawSurpriseMe}); err != nil || drawn.Program.ID == "" {
		t.Fatalf("draw failed: result=%#v err=%v", drawn, err)
	}
	if _, err := a.Draw(store.DrawRequest{Mode: "made-up"}); err == nil {
		t.Fatal("unknown draw mode was accepted")
	}
}
