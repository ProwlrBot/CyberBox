import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getApiKey } from "../../lib/api";

type Execution = {
  id: string;
  kind: string;
  status: string;
  risk_class: string | null;
  created_at: string;
  finished_at: string | null;
  error: string | null;
  project_id: string;
};

type Hypothesis = {
  id: string;
  title: string;
  severity: string;
  status: string;
  evidence: string[];
};

type Vulnerability = {
  id: string;
  name: string;
  severity: string;
  host: string;
  status: string;
  detected_at: string;
};

type Event = {
  id?: string;
  event_type: string;
  created_at?: string;
  timestamp?: string;
  message?: string;
};

type HealthData = {
  status: string;
  database: string;
  version: string;
};

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

function eventColor(type: string): string {
  if (type.startsWith("scan.")) return "var(--info)";
  if (type.startsWith("hypothesis.")) return "var(--warn)";
  if (type.startsWith("finding.")) return "var(--good)";
  if (type.startsWith("error.")) return "var(--bad)";
  return "var(--muted)";
}

const SEV_COLOR: Record<string, string> = {
  critical: "var(--bad)",
  high: "var(--bad)",
  medium: "var(--warn)",
  low: "var(--info)",
  info: "var(--muted)",
};

export default function HQ() {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState("");
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [cveSweepCount, setCveSweepCount] = useState<number | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const headers = (): Record<string, string> => {
    const k = getApiKey();
    return k ? { "X-Api-Key": k } : {};
  };

  async function loadAll(pid: string) {
    const h = headers();
    const [execRes, hypoRes, vulnRes, evtRes, cveRes, healthRes] = await Promise.allSettled([
      fetch("/api/v1/executions?limit=100", { headers: h }),
      fetch(`/api/v1/projects/${pid}/hypotheses`, { headers: h }),
      fetch(`/api/v1/projects/${pid}/vulnerabilities`, { headers: h }),
      fetch(`/api/v1/projects/${pid}/events?limit=20`, { headers: h }),
      fetch(`/api/v1/projects/${pid}/cve-sweep`, { headers: h }),
      fetch("/api/v1/health", { headers: h }),
    ]);

    if (execRes.status === "fulfilled" && execRes.value.ok) {
      setExecutions(await execRes.value.json());
    }
    if (hypoRes.status === "fulfilled" && hypoRes.value.ok) {
      setHypotheses(await hypoRes.value.json());
    }
    if (vulnRes.status === "fulfilled" && vulnRes.value.ok) {
      setVulns(await vulnRes.value.json());
    }
    if (evtRes.status === "fulfilled" && evtRes.value.ok) {
      const data = await evtRes.value.json();
      setEvents(Array.isArray(data) ? data : data.events ?? []);
    }
    if (cveRes.status === "fulfilled" && cveRes.value.ok) {
      const data = await cveRes.value.json();
      setCveSweepCount(Array.isArray(data) ? data.length : (data?.count ?? data?.total ?? null));
    }
    if (healthRes.status === "fulfilled" && healthRes.value.ok) {
      setHealth(await healthRes.value.json());
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
        if (pid) await loadAll(pid);
      } catch {
        // ignore
      }
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, []);

  // Auto-refresh events every 10s
  useEffect(() => {
    if (!projectId) return;
    const h = headers();
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/v1/projects/${projectId}/events?limit=20`, { headers: h });
        if (r.ok) {
          const data = await r.json();
          setEvents(Array.isArray(data) ? data : data.events ?? []);
        }
      } catch {
        // ignore
      }
    }, 10000);
    return () => clearInterval(iv);
  }, [projectId]);

  const runningExecs = executions.filter((e) => e.status === "running");
  const openHypos = hypotheses.filter((h) => h.status === "open");

  const statCells = [
    {
      label: "CVEs Swept",
      value: cveSweepCount !== null ? String(cveSweepCount) : "—",
      color: "var(--warn)",
    },
    {
      label: "Open Hypotheses",
      value: String(openHypos.length),
      color: "var(--accent)",
    },
    {
      label: "Running Executions",
      value: String(runningExecs.length),
      color: "var(--info)",
    },
    {
      label: "Vulnerabilities",
      value: String(vulns.length),
      color: "var(--bad)",
    },
  ];

  const statRowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
    padding: "16px 20px 0",
  };

  const statCellStyle = (color: string): React.CSSProperties => ({
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  });

  const colsStyle: React.CSSProperties = {
    display: "flex",
    gap: 16,
    padding: "16px 20px",
    flex: 1,
    overflow: "hidden",
  };

  const colStyle = (flex: string): React.CSSProperties => ({
    flex,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    minWidth: 0,
  });

  const sectionStyle: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: 12,
    marginBottom: 10,
  };

  const sectionHeadStyle: React.CSSProperties = {
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 10,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: "1px solid var(--border)",
  };

  const quickBtnStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    padding: "9px 12px",
    marginBottom: 6,
    background: "var(--panel-2)",
    border: "1px solid var(--border)",
    borderRadius: 3,
    color: "var(--text)",
    fontSize: 12,
    fontFamily: "JetBrains Mono, monospace",
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 0.15s",
  };

  if (loading) return <div className="page-targets"><div className="page-loading">Loading…</div></div>;

  return (
    <div className="page-targets" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Toolbar */}
      <div className="page-toolbar">
        <div className="page-title">
          <Monitor size={16} />
          <span>HQ</span>
          <small>Command Center</small>
        </div>
      </div>

      {/* Stat row */}
      <div style={statRowStyle}>
        {statCells.map((s) => (
          <div key={s.label} style={statCellStyle(s.color)}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 22, fontWeight: 700, color: s.color }}>
              {s.value}
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* 3 columns */}
      <div style={colsStyle}>
        {/* Column 1: Live Feed (40%) */}
        <div style={colStyle("0 0 40%")}>
          <div style={sectionStyle}>
            <div style={sectionHeadStyle}>Live Feed</div>
            {events.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 12, padding: "8px 0" }}>No recent events</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {events.map((ev, i) => {
                  const ts = ev.created_at ?? ev.timestamp ?? "";
                  const color = eventColor(ev.event_type ?? "");
                  return (
                    <div key={ev.id ?? i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: "50%", background: color,
                        flexShrink: 0, marginTop: 4,
                      }} />
                      <span style={{ flex: 1, color: "var(--text)", lineHeight: 1.4 }}>
                        {ev.event_type ?? "event"}
                        {ev.message ? <span style={{ color: "var(--muted)", marginLeft: 6 }}>{ev.message}</span> : null}
                      </span>
                      {ts && (
                        <span style={{ color: "var(--muted)", fontSize: 10, whiteSpace: "nowrap", flexShrink: 0 }}>
                          {timeAgo(ts)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Active Work (35%) */}
        <div style={colStyle("0 0 35%")}>
          {/* Running executions */}
          <div style={sectionStyle}>
            <div style={sectionHeadStyle}>Active Executions</div>
            {runningExecs.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 12 }}>No active executions</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {runningExecs.map((ex) => (
                  <div key={ex.id} style={{
                    display: "flex", alignItems: "center", gap: 8, fontSize: 12,
                    padding: "6px 8px", background: "var(--panel-2)", borderRadius: 3,
                  }}>
                    <code className="type-badge">{ex.kind}</code>
                    <span style={{ color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ex.project_id.slice(0, 12)}…
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: 10 }}>
                      {ex.created_at ? timeAgo(ex.created_at) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Open hypotheses */}
          <div style={sectionStyle}>
            <div style={sectionHeadStyle}>
              Open Hypotheses
              <button
                onClick={() => navigate("/hunt/evidence")}
                style={{ float: "right", background: "none", border: "none", color: "var(--accent)", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}
              >
                View all →
              </button>
            </div>
            <div style={{ marginBottom: 8, fontSize: 20, fontWeight: 700, color: "var(--accent)", fontFamily: "JetBrains Mono, monospace" }}>
              {openHypos.length}
            </div>
            {openHypos.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 12 }}>No open hypotheses</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {openHypos.slice(0, 5).map((hyp) => (
                  <div key={hyp.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                      background: SEV_COLOR[hyp.severity?.toLowerCase()] ?? "var(--muted)",
                    }} />
                    <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {hyp.title.slice(0, 50)}{hyp.title.length > 50 ? "…" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Column 3: Quick Launch (25%) */}
        <div style={colStyle("0 0 25%")}>
          <div style={sectionStyle}>
            <div style={sectionHeadStyle}>Quick Launch</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {[
                { label: "⚡ CVE Sweep",       path: "/hunt/cve-intel" },
                { label: "🔍 Recon Scan",       path: "/hunt/recon" },
                { label: "🦅 Raptor GitLab",    path: "/source/raptor" },
                { label: "📦 Raptor Vercel",    path: "/source/raptor" },
                { label: "📋 WordPress",        path: "/labs/wordpress" },
                { label: "🌐 Gori Traffic",     path: "/hunt/traffic" },
              ].map((btn) => (
                <button
                  key={btn.label}
                  style={quickBtnStyle}
                  onClick={() => navigate(btn.path)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* System health mini */}
          <div style={sectionStyle}>
            <div style={sectionHeadStyle}>System Health</div>
            {!health ? (
              <div style={{ color: "var(--muted)", fontSize: 12 }}>Loading health…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: health.status === "ok" ? "var(--good)" : "var(--bad)",
                    flexShrink: 0,
                  }} />
                  <span style={{ color: "var(--text)" }}>API: {health.status}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: health.database === "ok" ? "var(--good)" : "var(--bad)",
                    flexShrink: 0,
                  }} />
                  <span style={{ color: "var(--text)" }}>DB: {health.database}</span>
                </div>
                {health.version && (
                  <div style={{ color: "var(--muted)", fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
                    v{health.version}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
