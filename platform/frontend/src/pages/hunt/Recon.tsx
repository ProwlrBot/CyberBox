import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Engagement = { id: string; name: string };
type ScanResult = { id: string; target: string; profile: string; status: string; created_at: string; finished_at: string | null; log?: string };
type Execution = { id: string; kind: string; status: string; created_at: string; finished_at: string | null; project_id: string };
type Target = { id: string; pattern?: string; host?: string; type?: string; status?: string; created_at?: string; source?: string };

function loadSettings<T>(key: string, defaults: T): T {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; }
  catch { return defaults; }
}
function saveSettings<T>(key: string, s: T) { localStorage.setItem(key, JSON.stringify(s)); }

const PROFILE_OPTIONS = ["generic", "web", "api", "mobile", "iot"] as const;
type Profile = typeof PROFILE_OPTIONS[number];

const DEFAULT_SETTINGS = { profile: "web" as Profile };

export default function Recon() {
  const [projectId, setProjectId] = useState("");
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [settings, setSettings] = useState(loadSettings("recon_settings", DEFAULT_SETTINGS));

  const [target, setTarget] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<Profile>(settings.profile);
  const [selectedEngagement, setSelectedEngagement] = useState("");

  const [launching, setLaunching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [activeScan, setActiveScan] = useState<ScanResult | null>(null);

  const [executions, setExecutions] = useState<Execution[]>([]);
  const [reconTargets, setReconTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);

  const logRef = useRef<HTMLTextAreaElement>(null);

  const headers = (): Record<string, string> => {
    const k = getApiKey();
    return k ? { "X-Api-Key": k } : {};
  };

  function updateSettings(patch: Partial<typeof DEFAULT_SETTINGS>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings("recon_settings", next);
  }

  async function loadData(pid: string) {
    const h = headers();
    const [engRes, execRes, targetRes] = await Promise.allSettled([
      fetch(`/api/v1/projects/${pid}/engagements`, { headers: h }),
      fetch("/api/v1/executions?limit=50", { headers: h }),
      fetch(`/api/v1/projects/${pid}/targets`, { headers: h }),
    ]);
    if (engRes.status === "fulfilled" && engRes.value.ok) {
      const data = await engRes.value.json();
      const list: Engagement[] = Array.isArray(data) ? data : [];
      setEngagements(list);
      if (list.length > 0 && !selectedEngagement) setSelectedEngagement(list[0].id);
    }
    if (execRes.status === "fulfilled" && execRes.value.ok) {
      const data: Execution[] = await execRes.value.json();
      setExecutions(data.filter((e) => e.kind === "scan"));
    }
    if (targetRes.status === "fulfilled" && targetRes.value.ok) {
      const data: Target[] = await targetRes.value.json();
      setReconTargets(data.filter((t) => t.source === "recon"));
    }
  }

  useEffect(() => {
    let cancelled = false;
    const h = headers();
    async function init() {
      try {
        const r = await fetch("/api/v1/projects", { headers: h });
        const projects = r.ok ? await r.json() : [];
        const pid = projects[0]?.id ?? "";
        if (cancelled) return;
        setProjectId(pid);
        if (pid) await loadData(pid);
      } catch {
        // ignore
      }
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, []);

  // Poll active scan
  useEffect(() => {
    if (!activeScanId || !projectId) return;
    const h = headers();
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/v1/scans/${activeScanId}`, { headers: h });
        if (r.ok) {
          const data: ScanResult = await r.json();
          setActiveScan(data);
          if (logRef.current) {
            logRef.current.value = data.log ?? "";
            logRef.current.scrollTop = logRef.current.scrollHeight;
          }
          if (data.status !== "running") {
            clearInterval(iv);
            // Refresh targets after scan completes
            const tr = await fetch(`/api/v1/projects/${projectId}/targets`, { headers: h });
            if (tr.ok) {
              const tdata: Target[] = await tr.json();
              setReconTargets(tdata.filter((t) => t.source === "recon"));
            }
          }
        }
      } catch {
        // ignore
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [activeScanId, projectId]);

  async function launchRecon() {
    if (!target.trim() || !projectId) return;
    setLaunching(true);
    setToast(null);
    try {
      const h = { ...headers(), "Content-Type": "application/json" };
      const body: Record<string, string> = { target: target.trim(), profile: selectedProfile };
      if (selectedEngagement) body.engagement_id = selectedEngagement;
      const r = await fetch(`/api/v1/projects/${projectId}/scans`, {
        method: "POST",
        headers: h,
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const data = await r.json();
        const scanId = data.id ?? data.scan_id ?? data.execution_id ?? null;
        setActiveScanId(scanId);
        setActiveScan({ id: scanId ?? "", target: target.trim(), profile: selectedProfile, status: "running", created_at: new Date().toISOString(), finished_at: null });
        setToast(`Scan launched: ${scanId ?? "ok"}`);
        // refresh executions
        const er = await fetch("/api/v1/executions?limit=50", { headers: headers() });
        if (er.ok) {
          const edata: Execution[] = await er.json();
          setExecutions(edata.filter((e) => e.kind === "scan"));
        }
      } else {
        const err = await r.text();
        setToast(`Error: ${err}`);
      }
    } catch (e: unknown) {
      setToast(`Error: ${String(e)}`);
    }
    setLaunching(false);
  }

  function statusColor(s: string): string {
    if (s === "running") return "var(--info)";
    if (s === "completed") return "var(--good)";
    if (s === "failed") return "var(--bad)";
    return "var(--muted)";
  }

  const noEngagement = engagements.length === 0;

  const panelStyle: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "14px 16px",
    marginBottom: 14,
  };

  const headStyle: React.CSSProperties = {
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 10,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: "1px solid var(--border)",
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--panel-2)",
    border: "1px solid var(--border)",
    borderRadius: 3,
    color: "var(--text)",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 12,
    padding: "7px 10px",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    marginBottom: 4,
    display: "block",
  };

  if (loading) return <div className="page-targets"><div className="page-loading">Loading…</div></div>;

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Search size={16} />
          <span>Recon</span>
        </div>
      </div>

      <div style={{ padding: "16px 20px", maxWidth: 1100 }}>
        {/* Launch form */}
        <div style={panelStyle}>
          <div style={headStyle}>Launch Recon Scan</div>

          {noEngagement && (
            <div style={{
              background: "rgba(251,191,36,0.08)",
              border: "1px solid var(--warn)",
              borderRadius: 3,
              padding: "9px 12px",
              marginBottom: 14,
              fontSize: 12,
              color: "var(--warn)",
            }}>
              Create an engagement first — recon requires an active engagement
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 10, alignItems: "flex-end" }}>
            <div>
              <label style={labelStyle}>Target</label>
              <input
                style={{ ...inputStyle, width: "100%" }}
                placeholder="target.com or *.target.com"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") launchRecon(); }}
              />
            </div>
            <div>
              <label style={labelStyle}>Profile</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={selectedProfile}
                onChange={(e) => {
                  setSelectedProfile(e.target.value as Profile);
                  updateSettings({ profile: e.target.value as Profile });
                }}
              >
                {PROFILE_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Engagement</label>
              {engagements.length === 0 ? (
                <span style={{ ...inputStyle, display: "inline-block", color: "var(--muted)" }}>none</span>
              ) : (
                <select
                  style={{ ...inputStyle, cursor: "pointer" }}
                  value={selectedEngagement}
                  onChange={(e) => setSelectedEngagement(e.target.value)}
                >
                  {engagements.map((eng) => (
                    <option key={eng.id} value={eng.id}>{eng.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                className="action-btn primary"
                onClick={launchRecon}
                disabled={launching || !target.trim() || !projectId}
                style={{ padding: "7px 16px", fontSize: 12 }}
              >
                {launching ? "Launching…" : "Launch recon"}
              </button>
            </div>
          </div>

          {toast && (
            <div style={{
              marginTop: 10,
              padding: "7px 10px",
              background: toast.startsWith("Error") ? "rgba(248,113,113,0.1)" : "rgba(74,222,128,0.1)",
              border: `1px solid ${toast.startsWith("Error") ? "var(--bad)" : "var(--good)"}`,
              borderRadius: 3,
              fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
              color: toast.startsWith("Error") ? "var(--bad)" : "var(--good)",
            }}>
              {toast}
            </div>
          )}
        </div>

        {/* Active scan log */}
        {activeScan && (
          <div style={panelStyle}>
            <div style={headStyle}>Scan Log</div>
            <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 12, alignItems: "center" }}>
              <span style={{ color: "var(--muted)" }}>ID</span>
              <code className="mono-cell">{activeScan.id}</code>
              <span style={{ color: "var(--muted)", marginLeft: 8 }}>Status</span>
              <span style={{
                padding: "2px 8px",
                borderRadius: 3,
                fontSize: 10,
                fontFamily: "JetBrains Mono, monospace",
                background: `${statusColor(activeScan.status)}22`,
                color: statusColor(activeScan.status),
                border: `1px solid ${statusColor(activeScan.status)}44`,
              }}>
                {activeScan.status}
              </span>
            </div>
            <textarea
              ref={logRef}
              readOnly
              defaultValue={activeScan.log ?? "Waiting for log output…"}
              style={{
                width: "100%",
                height: 180,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                color: "var(--text)",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
                padding: "8px 10px",
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Results table */}
        <div style={panelStyle}>
          <div style={headStyle}>Scan History</div>
          {executions.length === 0 ? (
            <div className="empty-state-block">
              <p>No recon scans yet — enter a target above and launch</p>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Target / ID</th>
                    <th>Profile</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((ex) => (
                    <tr key={ex.id} className="data-row">
                      <td><code className="mono-cell">{ex.id.slice(0, 14)}…</code></td>
                      <td><code className="type-badge">scan</code></td>
                      <td>
                        <span style={{
                          padding: "2px 7px",
                          borderRadius: 3,
                          fontSize: 10,
                          fontFamily: "JetBrains Mono, monospace",
                          background: `${statusColor(ex.status)}22`,
                          color: statusColor(ex.status),
                          border: `1px solid ${statusColor(ex.status)}44`,
                        }}>
                          {ex.status}
                        </span>
                      </td>
                      <td className="time-cell">{new Date(ex.created_at).toLocaleString()}</td>
                      <td className="time-cell">{ex.finished_at ? new Date(ex.finished_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Subdomains */}
        {reconTargets.length > 0 && (
          <div style={panelStyle}>
            <div style={headStyle}>Discovered Subdomains</div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Subdomain / Pattern</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {reconTargets.map((t) => (
                    <tr key={t.id} className="data-row">
                      <td><code className="mono-cell">{t.pattern ?? t.host ?? t.id}</code></td>
                      <td><code className="type-badge">{t.type ?? "host"}</code></td>
                      <td>
                        <span style={{ color: t.status === "active" ? "var(--good)" : "var(--muted)", fontSize: 12 }}>
                          {t.status ?? "—"}
                        </span>
                      </td>
                      <td className="time-cell">{t.created_at ? new Date(t.created_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
