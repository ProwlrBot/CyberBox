import { useEffect, useState } from "react";
import { Zap, ExternalLink, Search, RefreshCw } from "lucide-react";
import { getApiKey } from "../../lib/api";

interface VercelSettings {
  token: string;
  teamId: string;
  targetProject: string;
}

const DEFAULTS: VercelSettings = { token: "", teamId: "", targetProject: "" };

function loadSettings<T>(key: string, defaults: T): T {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; }
  catch { return defaults; }
}
function saveSettings<T>(key: string, s: T) { localStorage.setItem(key, JSON.stringify(s)); }

type Deployment = {
  uid: string;
  url: string;
  state: string;
  meta?: { githubCommitRef?: string; githubCommitMessage?: string };
  createdAt: number;
};

type ProbeResult = { path: string; status: number | null; ok: boolean };

const PROBE_PATHS = [
  "/api/health",
  "/api/",
  "/api/user",
  "/api/auth",
  "/_vercel/speed-insights",
  "/_next/static/chunks/main.js.map",
  "/.env",
  "/api/admin",
];

const PLAYBOOK = [
  `Enumerate deployments: curl https://api.vercel.com/v6/deployments?teamId=X -H "Authorization: Bearer TOKEN"`,
  "Check build logs for exposed secrets: GET /v1/deployments/{id}/builds",
  "Test preview deployments: project-git-branch-owner.vercel.app",
  "Probe source maps: target.com/_next/static/chunks/main.js.map",
  "Test /api/ routes for missing auth (try unauthenticated, different methods)",
  "Check environment variables leak in client bundle: grep for NEXT_PUBLIC_ in JS",
];

export default function VercelLab() {
  const [settings, setSettings] = useState<VercelSettings>(() => loadSettings("cbx.lab.vercel", DEFAULTS));
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [probeDomain, setProbeDomain] = useState("");
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([]);
  const [probing, setProbing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function updateSetting<K extends keyof VercelSettings>(k: K, v: VercelSettings[K]) {
    const next = { ...settings, [k]: v };
    setSettings(next);
    saveSettings("cbx.lab.vercel", next);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function fetchDeployments() {
    if (!settings.token) { setDeployError("Configure Vercel token in settings above"); return; }
    setDeployLoading(true);
    setDeployError(null);
    try {
      const teamParam = settings.teamId ? `?teamId=${encodeURIComponent(settings.teamId)}&limit=5` : "?limit=5";
      const r = await fetch(`https://api.vercel.com/v6/deployments${teamParam}`, {
        headers: { Authorization: `Bearer ${settings.token}` },
      });
      if (!r.ok) { setDeployError(`Vercel API error: ${r.status}`); return; }
      const data = await r.json();
      setDeployments((data.deployments ?? []).slice(0, 5));
    } catch {
      setDeployError("Network error — check token and CORS");
    } finally {
      setDeployLoading(false);
    }
  }

  useEffect(() => {
    if (settings.token) fetchDeployments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function probeFunctions() {
    if (!probeDomain) { showToast("Enter a target domain first"); return; }
    setProbing(true);
    setProbeResults([]);
    const base = probeDomain.startsWith("http") ? probeDomain.replace(/\/$/, "") : `https://${probeDomain}`;
    const results: ProbeResult[] = [];
    for (const path of PROBE_PATHS) {
      try {
        const r = await fetch(base + path, { method: "GET", signal: AbortSignal.timeout(5000) });
        results.push({ path, status: r.status, ok: r.status < 400 });
      } catch {
        results.push({ path, status: null, ok: false });
      }
    }
    setProbeResults(results);
    setProbing(false);
  }

  const stateColor: Record<string, string> = {
    READY: "var(--good)", ERROR: "var(--bad)", BUILDING: "var(--warn)", CANCELED: "var(--muted)",
    QUEUED: "var(--info)",
  };

  return (
    <div className="page-targets">
      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: "var(--panel-2)", border: "1px solid var(--accent)",
          color: "var(--accent)", padding: "10px 18px", borderRadius: 6,
          fontFamily: "monospace", fontSize: 13,
        }}>
          {toast}
        </div>
      )}

      <div className="page-toolbar">
        <div className="page-title">
          <Zap size={16} />
          <span>Vercel Hunt Lab</span>
        </div>
      </div>

      {/* Settings */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Settings</h2>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 20, display: "grid", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Vercel Token</span>
            <input
              style={{ padding: "7px 10px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontFamily: "monospace", fontSize: 13 }}
              type="password"
              value={settings.token}
              onChange={(e) => updateSetting("token", e.target.value)}
              placeholder="vercel token…"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Team ID (optional)</span>
            <input
              style={{ padding: "7px 10px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontFamily: "monospace", fontSize: 13 }}
              value={settings.teamId}
              onChange={(e) => updateSetting("teamId", e.target.value)}
              placeholder="team_xxxxxxxxxxxx"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Target Project</span>
            <input
              style={{ padding: "7px 10px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontFamily: "monospace", fontSize: 13 }}
              value={settings.targetProject}
              onChange={(e) => updateSetting("targetProject", e.target.value)}
              placeholder="project-name or domain"
            />
          </label>
        </div>
      </section>

      {/* Deployment Overview */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", margin: 0 }}>Deployment Overview</h2>
          <button className="action-btn" onClick={fetchDeployments} disabled={deployLoading}>
            <RefreshCw size={13} /> {deployLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {deployError ? (
          <div className="empty-state-block"><p>{deployError}</p></div>
        ) : deployments.length === 0 && !deployLoading ? (
          <div className="empty-state-block"><p>No deployments loaded. Add a token and click Refresh.</p></div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {deployments.map((d) => (
              <div key={d.uid} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, marginBottom: 4 }}>{d.url}</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 11, background: "var(--panel-2)", border: `1px solid ${stateColor[d.state] ?? "var(--border)"}`, color: stateColor[d.state] ?? "var(--muted)", padding: "1px 7px", borderRadius: 4 }}>
                      {d.state}
                    </span>
                    {d.meta?.githubCommitRef && (
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>branch: {d.meta.githubCommitRef}</span>
                    )}
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(d.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <a
                  href={`https://${d.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="action-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}
                >
                  <ExternalLink size={13} /> Open
                </a>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Function Discovery */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Function Discovery</h2>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <input
              style={{ flex: 1, padding: "7px 10px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontFamily: "monospace", fontSize: 13 }}
              value={probeDomain}
              onChange={(e) => setProbeDomain(e.target.value)}
              placeholder="target.vercel.app"
              onKeyDown={(e) => e.key === "Enter" && probeFunctions()}
            />
            <button className="action-btn primary" onClick={probeFunctions} disabled={probing}>
              <Search size={13} /> {probing ? "Probing…" : "Enumerate functions"}
            </button>
          </div>
          {probeResults.length > 0 && (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Status</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {probeResults.map((p) => (
                    <tr key={p.path} className="data-row">
                      <td><code className="mono-cell">{p.path}</code></td>
                      <td><span className="mono-cell" style={{ color: p.status === null ? "var(--muted)" : p.ok ? "var(--good)" : "var(--bad)" }}>{p.status ?? "timeout"}</span></td>
                      <td>
                        <span className="type-badge" style={{ color: p.ok ? "var(--good)" : p.status === null ? "var(--muted)" : "var(--bad)" }}>
                          {p.ok ? "RESPONDS" : p.status === null ? "TIMEOUT" : "BLOCKED"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Attack Playbook */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Attack Playbook — Vercel</h2>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
          <ol style={{ margin: 0, padding: "0 0 0 20px", display: "grid", gap: 12 }}>
            {PLAYBOOK.map((step, i) => (
              <li key={i} style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
                <code style={{ color: "var(--accent)", fontFamily: "monospace", fontSize: 12 }}>{step}</code>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
