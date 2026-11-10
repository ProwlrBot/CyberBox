import { useEffect, useState } from "react";
import { Brain, Save, RefreshCw } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Profile = {
  id: string;
  name: string;
  description: string;
  maturity: string;
};

type RuntimeData = {
  project?: { id: string; name: string } | null;
  engagement?: { id: string; name: string } | null;
  profile?: { id: string; name: string; maturity: string; description?: string } | null;
};

type ModelSettings = {
  preferredProvider: "openai" | "anthropic" | "ollama" | "auto";
  ollamaUrl: string;
  defaultModel: string;
};

const SETTINGS_KEY = "cbx.models";

const DEFAULT_SETTINGS: ModelSettings = {
  preferredProvider: "auto",
  ollamaUrl: "http://localhost:11434",
  defaultModel: "claude-opus-4-5",
};

function loadSettings<T>(key: string, defaults: T): T {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; }
  catch { return defaults; }
}
function saveSettings<T>(key: string, s: T) { localStorage.setItem(key, JSON.stringify(s)); }

const MATURITY_COLOR: Record<string, string> = {
  stable: "var(--good)",
  preview: "var(--warn)",
  experimental: "var(--bad)",
};

export default function Models() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [runtime, setRuntime]   = useState<RuntimeData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [settings, setSettings] = useState<ModelSettings>(() => loadSettings(SETTINGS_KEY, DEFAULT_SETTINGS));
  const [toast, setToast]       = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

    async function fetchData() {
      try {
        const [profRes, projRes] = await Promise.all([
          fetch("/api/v1/profiles", { headers }),
          fetch("/api/v1/projects", { headers }),
        ]);
        const profs: Profile[] = profRes.ok ? await profRes.json() : [];
        const projs            = projRes.ok ? await projRes.json() : [];
        const pid: string      = projs[0]?.id ?? "";

        let rt: RuntimeData | null = null;
        if (pid) {
          const rtRes = await fetch("/api/v1/runtime", { headers });
          if (rtRes.ok) rt = await rtRes.json();
        }

        if (!cancelled) {
          setProfiles(Array.isArray(profs) ? profs : []);
          setRuntime(rt);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  function handleSave() {
    setSaving(true);
    saveSettings(SETTINGS_KEY, settings);
    setTimeout(() => {
      setSaving(false);
      showToast("Model settings saved");
    }, 300);
  }

  function set<K extends keyof ModelSettings>(k: K, v: ModelSettings[K]) {
    setSettings((prev) => ({ ...prev, [k]: v }));
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--panel-2)", border: "1px solid var(--border)",
    color: "var(--text)", padding: "7px 10px", borderRadius: 4, fontSize: 13,
    fontFamily: "JetBrains Mono, monospace", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4,
  };

  return (
    <div className="page-targets">
      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: "var(--panel-2)", border: "1px solid var(--accent)",
          color: "var(--accent)", padding: "10px 16px", borderRadius: 6,
          fontFamily: "JetBrains Mono, monospace", fontSize: 12,
        }}>
          {toast}
        </div>
      )}

      <div className="page-toolbar">
        <div className="page-title">
          <Brain size={16} />
          <span>AI Models</span>
          <small>{profiles.length} profiles</small>
        </div>
        <div className="toolbar-actions">
          <button className="action-btn" onClick={() => { setLoading(true); }} disabled={loading}>
            <RefreshCw size={13} style={{ marginRight: 4 }} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading model data…</div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* Runtime Profile */}
          <div style={{
            fontSize: 12, fontWeight: 600, color: "var(--muted)",
            marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
          }}>
            Runtime Profile
          </div>
          <div style={{
            background: "var(--panel)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "16px 18px", marginBottom: 28,
          }}>
            {runtime?.profile ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
                    {runtime.profile.name}
                  </span>
                  <code
                    className="type-badge"
                    style={{
                      color: MATURITY_COLOR[runtime.profile.maturity] ?? "var(--muted)",
                      borderColor: MATURITY_COLOR[runtime.profile.maturity] ?? "var(--border)",
                    }}
                  >
                    {runtime.profile.maturity}
                  </code>
                </div>
                <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.55 }}>
                  {(runtime.profile as Profile & { description?: string }).description ?? "No description available."}
                </p>
              </div>
            ) : (
              <span className="muted-cell">No active profile — configure one in Providers.</span>
            )}
          </div>

          {/* All Profiles Table */}
          <div style={{
            fontSize: 12, fontWeight: 600, color: "var(--muted)",
            marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
          }}>
            All Profiles
          </div>
          {profiles.length === 0 ? (
            <div className="empty-state-block">
              <p>No profiles loaded.</p>
            </div>
          ) : (
            <div className="data-table-wrap" style={{ marginBottom: 32 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Maturity</th>
                    <th>Description</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id} className="data-row">
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</td>
                      <td>
                        <code
                          className="type-badge"
                          style={{
                            color: MATURITY_COLOR[p.maturity] ?? "var(--muted)",
                            borderColor: MATURITY_COLOR[p.maturity] ?? "var(--border)",
                          }}
                        >
                          {p.maturity}
                        </code>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--muted)", maxWidth: 320 }}>
                        <span style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        } as React.CSSProperties}>
                          {p.description || "—"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="action-btn"
                          style={{ fontSize: 11 }}
                          onClick={() => showToast("Profile switching coming soon")}
                        >
                          Activate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Model Settings */}
          <div style={{
            fontSize: 12, fontWeight: 600, color: "var(--muted)",
            marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
            borderTop: "1px solid var(--border)", paddingTop: 24,
          }}>
            Model Settings
          </div>
          <div style={{
            background: "var(--panel)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "20px 20px 16px", marginBottom: 12,
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Preferred Provider</label>
                <select
                  style={{ ...inputStyle, fontFamily: "inherit" }}
                  value={settings.preferredProvider}
                  onChange={(e) => set("preferredProvider", e.target.value as ModelSettings["preferredProvider"])}
                >
                  <option value="auto">auto</option>
                  <option value="anthropic">anthropic</option>
                  <option value="openai">openai</option>
                  <option value="ollama">ollama</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Default Model</label>
                <input
                  style={inputStyle}
                  placeholder="claude-opus-4-5"
                  value={settings.defaultModel}
                  onChange={(e) => set("defaultModel", e.target.value)}
                />
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Ollama URL</label>
              <input
                style={inputStyle}
                placeholder="http://localhost:11434"
                value={settings.ollamaUrl}
                onChange={(e) => set("ollamaUrl", e.target.value)}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: 0, maxWidth: 480 }}>
                These settings inform autopilot model selection — configure{" "}
                <code style={{ color: "var(--accent)", fontFamily: "JetBrains Mono, monospace" }}>CYBERBOX_MODEL</code>{" "}
                env var for the server.
              </p>
              <button
                className="action-btn primary"
                style={{ padding: "7px 20px", fontSize: 13 }}
                disabled={saving}
                onClick={handleSave}
              >
                <Save size={13} style={{ marginRight: 5 }} />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
