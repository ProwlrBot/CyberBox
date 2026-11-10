import { useEffect, useState } from "react";
import { GitBranch, Filter, Settings2, ChevronDown, ChevronUp } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Execution = {
  id: string;
  project_id: string;
  kind: string;
  status: string;
  risk_class: string | null;
  created_at: string;
  finished_at: string | null;
  error: string | null;
  metadata?: Record<string, unknown>;
};

interface GitLabSettings {
  gitlabUrl: string;
  token: string;
  repoPath: string;
  protocol: string;
  focus: string;
}

const DEFAULTS: GitLabSettings = {
  gitlabUrl: "https://gitlab.com",
  token: "",
  repoPath: "/home/anon/targets/gitlab/source/gitlab",
  protocol: "gitlab",
  focus: "",
};

const PROTOCOLS = ["gitlab", "gha", "go", "js", "php", "ruby"];

const STATUS_COLOR: Record<string, string> = {
  running: "var(--info)",
  completed: "var(--good)",
  done: "var(--good)",
  failed: "var(--bad)",
};

const CHECKLIST_ITEMS = [
  "CI/CD pipeline injection (commit to .gitlab-ci.yml)",
  "Runner escape / privilege escalation",
  "Repository secrets in CI variables",
  "GraphQL API enumeration (/api/graphql)",
  "Merge request SSRF / webhook abuse",
  "Container registry unauthenticated access",
  "Deploy token / personal access token exposure",
  "Import/export feature path traversal",
  "Protected branch bypass",
  "Subgroup/fork relationship IDOR",
  "SAST/DAST scan result exfiltration",
  "Job artifact path traversal",
];

const LS_SETTINGS = "cbx.gitlab";
const LS_CHECKLIST = "cbx.gitlab.checklist";

function loadSettings<T>(key: string, defaults: T): T {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; }
  catch { return defaults; }
}
function saveSettings<T>(key: string, s: T) { localStorage.setItem(key, JSON.stringify(s)); }

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "6px 10px",
  color: "var(--text)",
  fontSize: 12,
  fontFamily: "'JetBrains Mono', monospace",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
  display: "block",
};

export default function GitLabProfile() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [settings, setSettings] = useState<GitLabSettings>(() => loadSettings(LS_SETTINGS, DEFAULTS));
  const [draftSettings, setDraftSettings] = useState<GitLabSettings>(() => loadSettings(LS_SETTINGS, DEFAULTS));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => loadSettings(LS_CHECKLIST, {}));
  const [launching, setLaunching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

    async function init() {
      try {
        const pResp = await fetch("/api/v1/projects", { headers });
        const projects = pResp.ok ? await pResp.json() : [];
        const pid = projects[0]?.id ?? "";
        if (!cancelled) setProjectId(pid);

        const eResp = await fetch("/api/v1/executions?limit=100", { headers });
        const data = eResp.ok ? await eResp.json() : [];
        if (!cancelled) {
          setExecutions((data as Execution[]).filter((e) => e.kind?.includes("raptor")));
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  }

  async function handleLaunch() {
    if (!settings.repoPath.trim()) { showToast("Set a repo path in settings first"); return; }
    setLaunching(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      let pid = projectId;
      if (!pid) {
        const pResp = await fetch("/api/v1/projects", { headers: key ? { "X-Api-Key": key } : {} });
        const projects = pResp.ok ? await pResp.json() : [];
        pid = projects[0]?.id ?? "";
        if (pid) setProjectId(pid);
      }
      if (!pid) { showToast("No project loaded — configure one in Settings"); setLaunching(false); return; }

      const body: Record<string, string> = {
        protocol: settings.protocol,
        target_path: settings.repoPath.trim(),
        output_format: "jsonl",
      };
      if (settings.focus.trim()) body.focus = settings.focus.trim();

      const r = await fetch(`/api/v1/projects/${pid}/raptor-scan`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const result = r.ok ? await r.json() : null;
      if (result?.execution_id) {
        showToast(`Launched — execution ${result.execution_id.slice(0, 12)}…`);
        const eResp = await fetch("/api/v1/executions?limit=100", { headers: key ? { "X-Api-Key": key } : {} });
        const data = eResp.ok ? await eResp.json() : [];
        setExecutions((data as Execution[]).filter((e) => e.kind?.includes("raptor")));
      } else {
        showToast("Launch failed — check API key / project");
      }
    } catch {
      showToast("Launch failed — network error");
    }
    setLaunching(false);
  }

  function saveAndClose() {
    setSettings({ ...draftSettings });
    saveSettings(LS_SETTINGS, draftSettings);
    setSettingsOpen(false);
    showToast("Settings saved");
  }

  function toggleCheck(item: string) {
    const next = { ...checklist, [item]: !checklist[item] };
    setChecklist(next);
    saveSettings(LS_CHECKLIST, next);
  }

  const filtered = filter
    ? executions.filter((e) =>
        e.id.toLowerCase().includes(filter.toLowerCase()) ||
        (e.status ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        (e.kind ?? "").toLowerCase().includes(filter.toLowerCase())
      )
    : executions;

  const checked = Object.values(checklist).filter(Boolean).length;

  return (
    <div className="page-targets">
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: "var(--panel-2)", border: "1px solid var(--border)",
          borderLeft: "3px solid var(--accent)", padding: "10px 16px",
          borderRadius: 6, fontSize: 13, color: "var(--text)", zIndex: 1000,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {toast}
        </div>
      )}

      {/* Toolbar */}
      <div className="page-toolbar">
        <div className="page-title">
          <GitBranch size={16} />
          <span>GitLab</span>
          <small>{executions.length} raptor scans</small>
        </div>
        <div className="toolbar-actions">
          <button
            className="action-btn"
            onClick={() => { setDraftSettings({ ...settings }); setSettingsOpen((o) => !o); }}
            style={{ display: "flex", alignItems: "center", gap: 5 }}
          >
            <Settings2 size={13} />
            Settings
            {settingsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button
            className="action-btn primary"
            onClick={handleLaunch}
            disabled={launching}
          >
            {launching ? "Launching…" : "Launch Raptor scan"}
          </button>
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input
              placeholder="Filter executions…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Collapsible Settings */}
      {settingsOpen && (
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid var(--border)",
          background: "var(--panel)", display: "flex", flexDirection: "column", gap: 14,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            <div>
              <label style={labelStyle}>GitLab URL</label>
              <input style={inputStyle} value={draftSettings.gitlabUrl}
                onChange={(e) => setDraftSettings({ ...draftSettings, gitlabUrl: e.target.value })}
                placeholder="https://gitlab.com" />
            </div>
            <div>
              <label style={labelStyle}>Personal Access Token</label>
              <input style={inputStyle} type="password" value={draftSettings.token}
                onChange={(e) => setDraftSettings({ ...draftSettings, token: e.target.value })}
                placeholder="glpat-…" />
            </div>
            <div>
              <label style={labelStyle}>Repo Path (local clone)</label>
              <input style={inputStyle} value={draftSettings.repoPath}
                onChange={(e) => setDraftSettings({ ...draftSettings, repoPath: e.target.value })}
                placeholder="/home/anon/targets/gitlab/source/gitlab" />
            </div>
            <div>
              <label style={labelStyle}>Protocol</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={draftSettings.protocol}
                onChange={(e) => setDraftSettings({ ...draftSettings, protocol: e.target.value })}
              >
                {PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Focus (optional)</label>
              <input style={inputStyle} value={draftSettings.focus}
                onChange={(e) => setDraftSettings({ ...draftSettings, focus: e.target.value })}
                placeholder="e.g. auth secrets injection" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="action-btn primary" onClick={saveAndClose}>Save</button>
            <button className="action-btn" onClick={() => setSettingsOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Attack Checklist */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
          Attack Checklist — {checked}/{CHECKLIST_ITEMS.length} checked
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 6 }}>
          {CHECKLIST_ITEMS.map((item) => (
            <label key={item} style={{
              display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
              fontSize: 12, color: checklist[item] ? "var(--muted)" : "var(--text)",
              textDecoration: checklist[item] ? "line-through" : "none",
              padding: "4px 6px", borderRadius: 4,
              background: checklist[item] ? "transparent" : "var(--panel)",
              border: "1px solid var(--border)",
            }}>
              <input
                type="checkbox"
                checked={!!checklist[item]}
                onChange={() => toggleCheck(item)}
                style={{ marginTop: 1, accentColor: "var(--accent)", flexShrink: 0 }}
              />
              {item}
            </label>
          ))}
        </div>
      </div>

      {/* Results Table */}
      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state-block">
          <p>No Raptor scans yet — configure settings and launch a scan above.</p>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Execution ID</th>
                <th>Protocol</th>
                <th>Status</th>
                <th>Findings</th>
                <th>Started</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="data-row">
                  <td><code className="mono-cell">{e.id.slice(0, 16)}…</code></td>
                  <td><code className="type-badge">{e.kind ?? "raptor"}</code></td>
                  <td>
                    <span className="sev-badge" style={{ color: STATUS_COLOR[e.status] ?? "var(--muted)" }}>
                      {e.status}
                    </span>
                  </td>
                  <td className="muted-cell">
                    {(e.metadata as Record<string, unknown>)?.findings_count != null
                      ? String((e.metadata as Record<string, unknown>).findings_count)
                      : "—"}
                  </td>
                  <td className="time-cell">{formatTime(e.created_at)}</td>
                  <td className="mono-cell" style={{ color: e.error ? "var(--bad)" : "var(--muted)" }}>
                    {e.error ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
