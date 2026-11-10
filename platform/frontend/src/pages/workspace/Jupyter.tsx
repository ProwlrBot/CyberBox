import { useEffect, useRef, useState } from "react";
import { BookOpen, ExternalLink, Settings as SettingsIcon, CheckCircle, XCircle } from "lucide-react";

type JupyterSettings = { url: string; token: string; };

const DEFAULT_SETTINGS: JupyterSettings = { url: "http://localhost:8888", token: "" };

function loadSettings(): JupyterSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("cbx.jupyter") ?? "{}") }; }
  catch { return DEFAULT_SETTINGS; }
}

const NOTEBOOKS = [
  { name: "Subdomain Analysis", file: "recon-analysis.ipynb", desc: "Analyze subfinder output, dedupe, rank by attack surface" },
  { name: "Response Clustering", file: "response-cluster.ipynb", desc: "Cluster HTTP responses by similarity for anomaly detection" },
  { name: "JWT Decoder", file: "jwt-analysis.ipynb", desc: "Decode and analyze JWT tokens from traffic logs" },
  { name: "CVE Correlator", file: "cve-correlator.ipynb", desc: "Match tech stack against NVD findings" },
];

export default function JupyterPage() {
  const [settings, setSettings] = useState<JupyterSettings>(loadSettings);
  const [draft, setDraft] = useState<JupyterSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<"checking" | "online" | "offline" | "unknown">("checking");
  const [copied, setCopied] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function checkStatus(s: JupyterSettings) {
    setStatus("checking");
    try {
      const r = await fetch(`${s.url}/api`, {
        headers: s.token ? { Authorization: `token ${s.token}` } : {},
        signal: AbortSignal.timeout(4000),
      });
      setStatus(r.ok ? "online" : "offline");
    } catch {
      setStatus("offline");
    }
  }

  useEffect(() => {
    checkStatus(settings);
    checkTimer.current = setInterval(() => checkStatus(settings), 5000);
    return () => { if (checkTimer.current) clearInterval(checkTimer.current); };
  }, [settings]);

  function saveSettings() {
    localStorage.setItem("cbx.jupyter", JSON.stringify(draft));
    setSettings(draft);
    setShowSettings(false);
  }

  function copyCommand() {
    navigator.clipboard.writeText("jupyter lab --no-browser --port=8888").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <BookOpen size={16} />
          <span>Jupyter</span>
          <span style={{
            fontSize: 10, padding: "2px 7px", borderRadius: 10, fontFamily: "'JetBrains Mono', monospace",
            background: status === "online" ? "rgba(74,222,128,0.1)" : status === "offline" ? "rgba(248,113,113,0.1)" : "rgba(251,191,36,0.1)",
            color: status === "online" ? "var(--good)" : status === "offline" ? "var(--bad)" : "var(--warn)",
            border: `1px solid ${status === "online" ? "var(--good)" : status === "offline" ? "var(--bad)" : "var(--warn)"}`,
          }}>
            {status === "checking" ? "Checking…" : status === "online" ? "● Online" : "○ Offline"}
          </span>
        </div>
        <div className="toolbar-actions">
          <button className="action-btn" onClick={() => { setDraft(settings); setShowSettings((p) => !p); }}>
            <SettingsIcon size={13} /> Settings
          </button>
          <button
            className="action-btn primary"
            disabled={status !== "online"}
            onClick={() => window.open(settings.url, "_blank")}
          >
            <ExternalLink size={13} /> Open Jupyter
          </button>
        </div>
      </div>

      {showSettings && (
        <div style={{ padding: "16px 20px", background: "var(--panel-2)", borderBottom: "1px solid var(--border)", display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--muted)" }}>
              Jupyter URL
              <input
                value={draft.url}
                onChange={(e) => setDraft((p) => ({ ...p, url: e.target.value }))}
                style={{ height: 32, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "0 10px", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, outline: "none" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--muted)" }}>
              Token (optional)
              <input
                type="password"
                value={draft.token}
                onChange={(e) => setDraft((p) => ({ ...p, token: e.target.value }))}
                placeholder="leave blank for no-auth"
                style={{ height: 32, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "0 10px", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, outline: "none" }}
              />
            </label>
          </div>
          <div>
            <button className="action-btn primary" onClick={saveSettings}>Save</button>
          </div>
        </div>
      )}

      <div style={{ padding: 24, display: "grid", gap: 24 }}>
        {/* Status card */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          {status === "checking" && (
            <>
              <div style={{ width: 32, height: 32, border: "2px solid var(--warn)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Checking connection…</span>
            </>
          )}
          {status === "online" && (
            <>
              <CheckCircle size={36} color="var(--good)" />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Jupyter is running</div>
                <code style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>{settings.url}</code>
              </div>
              <button className="action-btn primary" onClick={() => window.open(settings.url, "_blank")}>
                <ExternalLink size={13} /> Open in Browser
              </button>
            </>
          )}
          {status === "offline" && (
            <>
              <XCircle size={36} color="var(--bad)" />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Jupyter not running</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Start it with:</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <code style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 4, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "var(--text)" }}>
                    jupyter lab --no-browser --port=8888
                  </code>
                  <button className="action-btn" onClick={copyCommand}>{copied ? "✓ Copied" : "Copy"}</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Quick notebooks */}
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>Quick Notebooks</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {NOTEBOOKS.map((nb) => (
              <div key={nb.file} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{nb.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{nb.desc}</div>
                <button
                  className="action-btn"
                  disabled={status !== "online"}
                  onClick={() => window.open(`${settings.url}/tree/${nb.file}`, "_blank")}
                  style={{ alignSelf: "flex-start", marginTop: 4 }}
                >
                  <ExternalLink size={11} /> Open
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
