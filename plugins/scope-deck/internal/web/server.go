package web

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"strings"

	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/app"
	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/model"
	"github.com/ProwlrBot/CyberBox/plugins/scope-deck/internal/store"
)

//go:embed static/*
var assets embed.FS

type Server struct {
	App *app.App
	mux *http.ServeMux
}

func New(a *app.App) *Server {
	s := &Server{App: a, mux: http.NewServeMux()}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler { return s.securityHeaders(s.mux) }

func (s *Server) routes() {
	s.mux.HandleFunc("/api/health", s.handleHealth)
	s.mux.HandleFunc("/api/v1/programs", s.handlePrograms)
	s.mux.HandleFunc("/api/v1/programs/", s.handleProgram)
	s.mux.HandleFunc("/api/v1/draw", s.handleDraw)
	s.mux.HandleFunc("/api/v1/source-sync", s.handleSync)
	s.mux.HandleFunc("/api/v1/programs/compare", s.handleCompare)
	s.mux.HandleFunc("/", s.handleIndex)
	s.mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticFS{assets}))))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, http.StatusOK, s.App.Health())
}

func (s *Server) handlePrograms(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query().Get("q")
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		fmt.Sscanf(raw, "%d", &limit)
	}
	platform := r.URL.Query().Get("platform")
	scopeState := r.URL.Query().Get("scope_state")
	items, err := s.App.Store.Programs(store.ProgramFilter{Query: q, Limit: limit, Platform: platform, ScopeState: scopeState})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleProgram(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/programs/")
	if path == "" {
		http.NotFound(w, r)
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) == 1 {
		program, err := s.App.Program(parts[0])
		if err != nil {
			http.NotFound(w, r)
			return
		}
		s.writeJSON(w, http.StatusOK, program)
		return
	}
	switch parts[1] {
	case "score":
		program, err := s.App.Program(parts[0])
		if err != nil {
			http.NotFound(w, r)
			return
		}
		score := program.Score
		if score.OpportunityScore == 0 {
			score = model.TargetScore{OpportunityScore: program.OpportunityScore, DataConfidence: program.DataConfidence}
		}
		s.writeJSON(w, http.StatusOK, score)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleCompare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	raw := r.URL.Query()["id"]
	if len(raw) == 0 {
		if ids := r.URL.Query().Get("ids"); ids != "" {
			raw = strings.Split(ids, ",")
		}
	}
	items, err := s.App.Compare(raw)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleDraw(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req store.DrawRequest
	if err := decodeJSON(w, r, &req); err != nil && err != io.EOF {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Limit == 0 {
		req.Limit = 1
	}
	if req.Mode == "" {
		req.Mode = model.DrawSurpriseMe
	}
	result, err := s.App.Draw(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	s.writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Kind      string `json:"kind"`
		SourceURL string `json:"source_url"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	result, err := s.App.SyncSource(req.Kind, req.SourceURL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.writeJSON(w, http.StatusOK, result)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, value any) error {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		return fmt.Errorf("content type must be application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(value)
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			if origin := r.Header.Get("Origin"); origin != "" {
				parsed, err := url.Parse(origin)
				if err != nil || !strings.EqualFold(parsed.Host, r.Host) {
					http.Error(w, "cross-origin request denied", http.StatusForbidden)
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/static/") {
		http.NotFound(w, r)
		return
	}
	tmpl, err := template.New("index").Parse(indexHTML)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = tmpl.Execute(w, map[string]any{
		"Title": "ScopeDeck",
	})
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type staticFS struct{ embed.FS }

func (s staticFS) Open(name string) (fs.File, error) { return s.FS.Open("static/" + name) }

const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ScopeDeck</title>
  <link rel="stylesheet" href="/static/app.css">
</head>
<body>
  <div id="app"></div>
  <script src="/static/app.js"></script>
</body>
</html>`
