import { useEffect, useState } from "react";
import { Globe, Filter, Settings2, ChevronDown, ChevronUp } from "lucide-react";
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
};

type VercelDeployment = {
  uid: string;
  url: string;
  state: string;
  created: number;
  meta?: { githubCommitRef?: string };
};

interface VercelSettings {
  token: string;
  teamId: string;
  targetDomain: string;
  sourcePath: string;
  functionPrefix: string;
}

const DEFAULTS: VercelSettings = {
  token: "",
  teamId: "",
  targetDomain: "",
  sourcePath: "",
  functionPrefix: "/api/",
};

const LS_SETTINGS = "cbx.vercel";
const LS_CHECKLIST = "cbx.vercel.checklist";

function loadSettings<T>(key: string, defaults: T): T {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; }
  catch { return defaults; }
}
function saveSettings<T>(key: string, s: T) { localStorage.setItem(key, JSON.stringify(s)); }

const STATUS_COLOR: Record<string, string> = {
  READY: "var(--good)",
  BUILDING: "var(--warn)",
  ERROR: "var(--bad)",
  CANCELED: "var(--muted)",
  QUEUED: "var(--info)",
};

const EXEC_STATUS_COLOR: Record<string, string> = {
  running: "var(--info)",
  completed: "var(--good)",
  done: "var(--good)",
  failed: "var(--bad)",
};

const CHECKLIST_ITEMS = [
  "Exposed .env / environment variables in build logs",
  "Serverless function SSRF via user-supplied URL param",
  "Path traversal in Next.js rewrites/redirects",
  "Prototype pollution in edge functions",
  "Insecure direct object references in /api/ routes",
  "Exposed debug endpoints (/api/health, /_next/static/chunks/...)",
  "Vercel deployment URL enumeration (project-git-owner.vercel.app)",
  "Source map exposure (*.js.map) — credentials/secrets in source",
  "GraphQL introspection enabled in production",
  "JWT secret/NEXTAUTH_SECRET in client-side bundle",
  "Rate limiting bypass on serverless functions",
  "Open CORS policy on /api/* routes",
];

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

export default function VercelProfile() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [settings, setSettings] = useState<VercelSettings>(() => loadSettings(LS_SETTINGS, DEFAULTS));
  const [draftSettings, setDraftSettings] = useState<VercelSettings>(() => loadSettings(LS_SETTINGS, DEFAULTS));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => loadSettings(LS_CHECKLIST, {}));
  const [deployments, setDeployments] = useState<VercelDeployment[]>([]);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [launchingJs, setLaunchingJs] = useState(false);
  const [launchingNuclei, setLaunchingNuclei] = useState(false);
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
          setExecutions((data as Execution[]).slice(0, 20));
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settings.token) return;
    fetchDeployments(settings.token, settings.teamId);
  }, [settings.token, settings.teamId]);

  async function fetchDeployments(token: string, teamId: string) {
    if (!token) return;
    setDeployLoading(true);
    setDeployError(null);
    try {
      const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}&limit=10` : "?limit=10";
      const r = await fetch(`https://api.vercel.com/v6/deployments${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        setDeployError(`Vercel API returned ${r.status} — check token / team ID`);
        setDeployLoading(false);
        return;
      }
      const data = await r.json();
      setDeployments(data.deployments ?? []);
    } catch {
      setDeployError("CORS blocked — open Vercel API in browser: https://api.vercel.com/v6/deployments");
    }
    setDeployLoading(false);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  }

  async function getOrFetchProjectId(): Promise<string> {
    if (projectId) return projectId;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
    const pResp = await fetch("/api/v1/projects", { headers });
    const projects = pResp.ok ? await pResp.json() : [];
    const pid = projects[0]?.id ?? "";
    if (pid) setProjectId(pid);
    return pid;
  }

  async function handleJsScan() {
    if (!settings.sourcePath.trim()) { showToast("Set a source path in settings first"); return; }
    setLaunchingJs(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const pid = await getOrFetchProjectId();
      if (!pid) { showToast("No project loaded"); setLaunchingJs(false); return; }

      const r = await fetch(`/api/v1/projects/${pid}/raptor-scan`, {
        method: "POST",
        headers,
        body: JSON.stringify({ protocol: "js", target_path: settings.sourcePath.trim(), output_format: "jsonl" }),
      });
      const result = r.ok ? await r.json() : null;
      if (result?.execution_id) {
        showToast(`JS scan launched — ${result.execution_id.slice(0, 12)}…`);
        const eResp = await fetch("/api/v1/executions?limit=100", { headers: key ? { "X-Api-Key": key } : {} });
        const data = eResp.ok ? await eResp.json() : [];
        setExecutions((data as Execution[]).slice(0, 20));
      } else {
        showToast("JS scan failed — check API key / project");
      }
    } catch {
      showToast("Launch failed — network error");
    }
    setLaunchingJs(false);
  }

  async function handleNucleiSweep() {
    if (!settings.targetDomain.trim()) { showToast("Set a target domain in settings first"); return; }
    setLaunchingNuclei(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const pid = await getOrFetchProjectId();
      if (!pid) { showToast("No project loaded"); setLaunchingNuclei(false); return; }

      const r = await fetch(`/api/v1/projects/${pid}/scans`, {
        method: "POST",
        headers,
        body: JSON.stringify({ target: settings.targetDomain.trim(), profile: "generic" }),
      });
      const result = r.ok ? await r.json() : null;
      if (result?.id) {
        showToast(`Nuclei sweep launched — ${result.id.slice(0, 12)}…`);
      } else {
        showToast("Nuclei sweep failed — check API key / project");
      }
    } catch {
      showToast("Launch failed — network error");
    }
    setLaunchingNuclei(false);
  }

  function saveAndClose() {
    setSettings({ ...draftSettings });
    saveSettings(LS_SETTINGS, draftSettings);
    setSettingsOpen(false);
    showToast("Settings saved");
    if (draftSettings.token) fetchDeployments(draftSettings.token, draftSettings.teamId);
  }

  function toggleCheck(item: string) {
    const next = { ...checklist, [item]: !checklist[item] };
    setChecklist(next);
    saveSettings(LS_CHECKLIST, next);
  }

  const filtered = filter
    ? executions.filter((e) =>
        e.id.toLowerCase().includes(filter.toLowerCase()) ||
        (e.status ?? "").toLowerCase().includes(filter.toLowerCase())
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
          <Globe size={16} style={{ color: "var(--info)" }} />
          <span>Vercel Hunt</span>
          <small>{executions.length} recent scans</small>
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
          <button className="action-btn primary" onClick={handleJsScan} disabled={launchingJs}>
            {launchingJs ? "Scanning…" : "Scan source (JS)"}
          </button>
          <button className="action-btn" onClick={handleNucleiSweep} disabled={launchingNuclei}>
            {launchingNuclei ? "Sweeping…" : "Run nuclei sweep"}
          </button>
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input
              placeholder="Filter…"
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
              <label style={labelStyle}>Vercel API Token</label>
              <input style={inputStyle} type="password" value={draftSettings.token}
                onChange={(e) => setDraftSettings({ ...draftSettings, token: e.target.value })}
                placeholder="vercel token…" />
            </div>
            <div>
              <label style={labelStyle}>Team ID (optional)</label>
              <input style={inputStyle} value={draftSettings.teamId}
                onChange={(e) => setDraftSettings({ ...draftSettings, teamId: e.target.value })}
                placeholder="team_xxx" />
            </div>
            <div>
              <label style={labelStyle}>Target Domain</label>
              <input style={inputStyle} value={draftSettings.targetDomain}
                onChange={(e) => setDraftSettings({ ...draftSettings, targetDomain: e.target.value })}
                placeholder="myapp.vercel.app" />
            </div>
            <div>
              <label style={labelStyle}>Source Path (local clone)</label>
              <input style={inputStyle} value={draftSettings.sourcePath}
                onChange={(e) => setDraftSettings({ ...draftSettings, sourcePath: e.target.value })}
                placeholder="/home/anon/targets/vercel/source" />
            </div>
            <div>
              <label style={labelStyle}>Serverless Function Prefix</label>
              <input style={inputStyle} value={draftSettings.functionPrefix}
                onChange={(e) => setDraftSettings({ ...draftSettings, functionPrefix: e.target.value })}
                placeholder="/api/" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="action-btn primary" onClick={saveAndClose}>Save</button>
            <button className="action-btn" onClick={() => setSettingsOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Vercel Deployments */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
          Recent Deployments
          {settings.token && (
            <span style={{ marginLeft: 10, color: "var(--accent)", cursor: "pointer", fontSize: 11 }}
              onClick={() => fetchDeployments(settings.token, settings.teamId)}>
              ↻ Refresh
            </span>
          )}
        </div>
        {!settings.token ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Set a Vercel API token in settings to view deployments.
          </div>
        ) : deployLoading ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading deployments…</div>
        ) : deployError ? (
          <div style={{ fontSize: 12, color: "var(--warn)", padding: "8px 0" }}>
            {deployError}
          </div>
        ) : deployments.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>No deployments found.</div>
        ) : (
          <div className="data-table-wrap" style={{ marginTop: 0 }}>
            <table className="data-table">
              <thead>
                <tr><th>URL</th><th>State</th><th>Created</th><th>Branch</th></tr>
              </thead>
              <tbody>
                {deployments.map((d) => (
                  <tr key={d.uid} className="data-row">
                    <td>
                      <a href={`https://${d.url}`} target="_blank" rel="noopener noreferrer"
                        style={{ color: "var(--accent)", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                        {d.url}
                      </a>
                    </td>
                    <td>
                      <span className="sev-badge" style={{ color: STATUS_COLOR[d.state] ?? "var(--muted)" }}>
                        {d.state}
                      </span>
                    </td>
                    <td className="time-cell">{new Date(d.created).toLocaleString()}</td>
                    <td className="muted-cell">{d.meta?.githubCommitRef ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
          <p>No scan executions yet — launch JS scan or nuclei sweep above.</p>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Execution ID</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Started</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="data-row">
                  <td><code className="mono-cell">{e.id.slice(0, 16)}…</code></td>
                  <td><code className="type-badge">{e.kind ?? "scan"}</code></td>
                  <td>
                    <span className="sev-badge" style={{ color: EXEC_STATUS_COLOR[e.status] ?? "var(--muted)" }}>
                      {e.status}
                    </span>
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
