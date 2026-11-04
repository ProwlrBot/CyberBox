package sources

import (
	"encoding/csv"
	"encoding/json"
	"io"
	"strings"

	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/model"
)

type manualJSON struct{}

func (manualJSON) Name() string      { return "manual-json" }
func (manualJSON) Kind() string      { return "manual" }
func (manualJSON) Authority() string { return string(model.SourceUserProvided) }

func (manualJSON) Parse(r io.Reader, sourceURL string) ([]Record, error) {
	var payload struct {
		Source struct {
			Name      string `json:"name"`
			Slug      string `json:"slug"`
			Kind      string `json:"kind"`
			Authority string `json:"authority"`
		} `json:"source"`
		Programs []map[string]any `json:"programs"`
	}
	if err := json.NewDecoder(r).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Source.Name == "" {
		payload.Source.Name = "manual-json"
	}
	if payload.Source.Slug == "" {
		payload.Source.Slug = normalizeSlug(payload.Source.Name)
	}
	if payload.Source.Kind == "" {
		payload.Source.Kind = "manual"
	}
	if payload.Source.Authority == "" {
		payload.Source.Authority = string(model.SourceUserProvided)
	}
	records := make([]Record, 0, len(payload.Programs))
	for _, item := range payload.Programs {
		item["source_name"] = payload.Source.Name
		item["source_slug"] = payload.Source.Slug
		item["source_kind"] = payload.Source.Kind
		item["source_record_url"] = sourceURL
		item["source_record_id"] = firstString(
			safeString(item["source_record_id"]),
			safeString(item["id"]),
			safeString(item["slug"]),
			safeString(item["name"]),
		)
		records = append(records, fromMap(item, sourceURL, model.SourceAuthority(payload.Source.Authority)))
	}
	return records, nil
}

type manualCSV struct{}

func (manualCSV) Name() string      { return "manual-csv" }
func (manualCSV) Kind() string      { return "manual" }
func (manualCSV) Authority() string { return string(model.SourceUserProvided) }

func (manualCSV) Parse(r io.Reader, sourceURL string) ([]Record, error) {
	reader := csv.NewReader(r)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}
	var records []Record
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		m := map[string]any{}
		for i, key := range header {
			if i < len(row) {
				m[strings.TrimSpace(strings.ToLower(key))] = row[i]
			}
		}
		m["source_name"] = "manual-csv"
		m["source_slug"] = "manual-csv"
		m["source_kind"] = "manual"
		m["source_record_url"] = sourceURL
		m["source_record_id"] = firstString(safeString(m["source_record_id"]), safeString(m["id"]), safeString(m["slug"]), safeString(m["name"]))
		records = append(records, fromMap(m, sourceURL, model.SourceUserProvided))
	}
	return records, nil
}

func firstString(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" && v != "<nil>" {
			return v
		}
	}
	return ""
}
