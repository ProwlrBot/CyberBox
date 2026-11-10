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

type WpUser = {
  id: number;
  name: string;
  slug: string;
  link?: string;
};

interface WpSettings {
  targetUrl: string;
  apiToken: string;
  sourcePath: string;
  pluginSlug: string;
}

const DEFAULTS: WpSettings = {
  targetUrl: "",
  apiToken: "",
  sourcePath: "",
  pluginSlug: "",
};

const LS_SETTINGS = "cbx.wordpress";
const LS_CHECKLIST = "cbx.wordpress.checklist";

function loadSettings<T>(key: string, defaults: T): T {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; }
  catch { return defaults; }
}
function saveSettings<T>(key: string, s: T) { localStorage.setItem(key, JSON.stringify(s)); }

const STATUS_COLOR: Record<string, string> = {
  running: "var(--info)",
  completed: "var(--good)",
  done: "var(--good)",
  failed: "var(--bad)",
};

const CHECKLIST_ITEMS = [
  "WP-JSON user enumeration (/wp-json/wp/v2/users)",
  "xmlrpc.php brute force / amplification",
  "Default admin credentials (admin/admin, admin/password)",
  "Plugin authenticated RCE via file upload",
  "Subscriber-level privilege escalation (meta capabilities)",
  "Nonce bypass on AJAX handlers",
  "SQL injection via wpdb->query without prepare()",
  "Arbitrary file read via path traversal in plugin",
  "Unauthenticated REST endpoint abuse",
  "wp-cron.php SSRF",
  "Debug log exposure (/wp-content/debug.log)",
  "Backup file exposure (wp-config.php.bak, .sql)",
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

function normalizeUrl(url: string): string {
  if (!url) return "";
  return url.replace(/\/$/, "");
}

export default function WordPressProfile() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [settings, setSettings] = useState<WpSettings>(() => loadSettings(LS_SETTINGS, DEFAULTS));
  const [draftSettings, setDraftSettings] = useState<WpSettings>(() => loadSettings(LS_SETTINGS, DEFAULTS));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => loadSettings(LS_CHECKLIST, {}));
  const [wpUsers, setWpUsers] = useState<WpUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [launchingWf, setLaunchingWf] = useState(false);
  const [launchingPhp, setLaunchingPhp] = useState(false);
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
          setExecutions((data as Execution[]).filter((e) =>
            e.kind?.includes("wordfence") || e.kind?.includes("raptor")
          ));
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
    if (!settings.targetUrl) return;
    fetchWpUsers(settings.targetUrl);
  }, [settings.targetUrl]);

  async function fetchWpUsers(targetUrl: string) {
    if (!targetUrl) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      const base = normalizeUrl(targetUrl);
      const r = await fetch(`${base}/wp-json/wp/v2/users`, {
        headers: settings.apiToken
          ? { Authorization: `Basic ${btoa(`:${settings.apiToken}`)}` }
          : {},
      });
      if (!r.ok) {
        setUsersError(`/wp-json/wp/v2/users returned ${r.status}`);
        setUsersLoading(false);
        return;
      }
      const data = await r.json();
      setWpUsers(Array.isArray(data) ? data : []);
    } catch {
      setUsersError("Could not reach target — check URL or CORS");
    }
    setUsersLoading(false);
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

  async function refreshExecutions() {
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
    const eResp = await fetch("/api/v1/executions?limit=100", { headers });
    const data = eResp.ok ? await eResp.json() : [];
    setExecutions((data as Execution[]).filter((e) =>
      e.kind?.includes("wordfence") || e.kind?.includes("raptor")
    ));
  }

  async function handleWordfence() {
    if (!settings.targetUrl.trim()) { showToast("Set a target URL in settings first"); return; }
    setLaunchingWf(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const pid = await getOrFetchProjectId();
      if (!pid) { showToast("No project loaded"); setLaunchingWf(false); return; }

      const r = await fetch(`/api/v1/projects/${pid}/wordfence/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ target_url: settings.targetUrl.trim() }),
      });
      const result = r.ok ? await r.json() : null;
      if (result?.id) {
        showToast(`Wordfence scan started — run ${result.id.slice(0, 12)}…`);
        await refreshExecutions();
      } else {
        showToast("Wordfence scan failed — check API key / project");
      }
    } catch {
      showToast("Launch failed — network error");
    }
    setLaunchingWf(false);
  }

  async function handlePhpAudit() {
    if (!settings.sourcePath.trim()) { showToast("Set a source path in settings first"); return; }
    setLaunchingPhp(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const pid = await getOrFetchProjectId();
      if (!pid) { showToast("No project loaded"); setLaunchingPhp(false); return; }

      const body: Record<string, string> = {
        protocol: "php",
        target_path: settings.sourcePath.trim(),
        output_format: "jsonl",
      };
      if (settings.pluginSlug.trim()) body.plugin = settings.pluginSlug.trim();

      const r = await fetch(`/api/v1/projects/${pid}/raptor-scan`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const result = r.ok ? await r.json() : null;
      if (result?.execution_id) {
        showToast(`PHP audit launched — ${result.execution_id.slice(0, 12)}…`);
        await refreshExecutions();
      } else {
        showToast("PHP audit failed — check API key / project");
      }
    } catch {
      showToast("Launch failed — network error");
    }
    setLaunchingPhp(false);
  }

  async function handleNucleiSweep() {
    if (!settings.targetUrl.trim()) { showToast("Set a target URL in settings first"); return; }
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
        body: JSON.stringify({ target: settings.targetUrl.trim(), profile: "generic" }),
      });
      const result = r.ok ? await r.json() : null;
      if (result?.id) {
        showToast(`WP nuclei sweep launched — ${result.id.slice(0, 12)}…`);
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
    if (draftSettings.targetUrl) fetchWpUsers(draftSettings.targetUrl);
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
  const base = normalizeUrl(settings.targetUrl);

  return (
    <div className="page-targets">
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: "var(--panel-2)", border: "1px solid var(--border)",
          borderLeft: "3px solid var(--warn)", padding: "10px 16px",
          borderRadius: 6, fontSize: 13, color: "var(--text)", zIndex: 1000,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {toast}
        </div>
      )}

      {/* Toolbar */}
      <div className="page-toolbar">
        <div className="page-title">
          <Globe size={16} style={{ color: "var(--warn)" }} />
          <span>WordPress Hunt</span>
          <small>{executions.length} scans</small>
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
          <button className="action-btn primary" onClick={handleWordfence} disabled={launchingWf}>
            {launchingWf ? "Scanning…" : "Wordfence scan"}
          </button>
          <button className="action-btn" onClick={handlePhpAudit} disabled={launchingPhp}>
            {launchingPhp ? "Auditing…" : "PHP source audit"}
          </button>
          <button className="action-btn" onClick={handleNucleiSweep} disabled={launchingNuclei}>
            {launchingNuclei ? "Sweeping…" : "WP nuclei sweep"}
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
              <label style={labelStyle}>Target URL</label>
              <input style={inputStyle} value={draftSettings.targetUrl}
                onChange={(e) => setDraftSettings({ ...draftSettings, targetUrl: e.target.value })}
                placeholder="https://target.com" />
            </div>
            <div>
              <label style={labelStyle}>WP Application Password</label>
              <input style={inputStyle} type="password" value={draftSettings.apiToken}
                onChange={(e) => setDraftSettings({ ...draftSettings, apiToken: e.target.value })}
                placeholder="user:app-password" />
            </div>
            <div>
              <label style={labelStyle}>Source Path (plugin/theme)</label>
              <input style={inputStyle} value={draftSettings.sourcePath}
                onChange={(e) => setDraftSettings({ ...draftSettings, sourcePath: e.target.value })}
                placeholder="/home/anon/targets/wp/plugins" />
            </div>
            <div>
              <label style={labelStyle}>Plugin Slug (optional)</label>
              <input style={inputStyle} value={draftSettings.pluginSlug}
                onChange={(e) => setDraftSettings({ ...draftSettings, pluginSlug: e.target.value })}
                placeholder="woocommerce" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="action-btn primary" onClick={saveAndClose}>Save</button>
            <button className="action-btn" onClick={() => setSettingsOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* WP-JSON Explorer */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
          WP-JSON User Enumeration
          {settings.targetUrl && (
            <>
              <span style={{ marginLeft: 10, color: "var(--accent)", cursor: "pointer", fontSize: 11 }}
                onClick={() => fetchWpUsers(settings.targetUrl)}>
                ↻ Refresh
              </span>
              <a
                href={`${base}/wp-json/`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: 10, color: "var(--info)", fontSize: 11, textDecoration: "none" }}
              >
                Full wp-json/ →
              </a>
            </>
          )}
        </div>
        {!settings.targetUrl ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Set a target URL in settings to probe WP-JSON.</div>
        ) : usersLoading ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Probing /wp-json/wp/v2/users…</div>
        ) : usersError ? (
          <div style={{ fontSize: 12, color: "var(--warn)", padding: "8px 0" }}>{usersError}</div>
        ) : wpUsers.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--good)", padding: "4px 0" }}>
            0 users exposed — endpoint blocked or returns empty array.
          </div>
        ) : (
          <div className="data-table-wrap" style={{ marginTop: 0 }}>
            <div style={{ fontSize: 12, color: "var(--bad)", marginBottom: 8 }}>
              {wpUsers.length} user{wpUsers.length > 1 ? "s" : ""} exposed via WP-JSON
            </div>
            <table className="data-table">
              <thead>
                <tr><th>ID</th><th>Name</th><th>Slug</th></tr>
              </thead>
              <tbody>
                {wpUsers.map((u) => (
                  <tr key={u.id} className="data-row">
                    <td className="mono-cell">{u.id}</td>
                    <td>{u.name}</td>
                    <td><code className="type-badge">{u.slug}</code></td>
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
          <p>No scans yet — run Wordfence scan, PHP audit, or nuclei sweep above.</p>
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
                    <span className="sev-badge" style={{ color: STATUS_COLOR[e.status] ?? "var(--muted)" }}>
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
