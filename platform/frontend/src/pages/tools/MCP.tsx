import { useEffect, useState } from "react";
import { Bot, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { getApiKey } from "../../lib/api";
import { Link } from "react-router-dom";

type Capability = {
  id: string;
  subject_type: string;
  subject_id: string;
  permissions: string[];
  expires_at: string | null;
  issued_at: string;
};

type GoriStatus = { reachable: boolean; gori_url?: string; pat_configured?: boolean };
type HealthData  = { status: string; database?: string; version?: string };
type Pack        = { id: string };

type MCPServer = {
  id: string;
  name: string;
  description: string;
  toolCount: string;
  statusKey: "gori" | "cyberbox" | "plugin";
};

const MCP_SERVERS: MCPServer[] = [
  {
    id: "gori",
    name: "gori",
    description: "HTTP proxy traffic, flow analysis, issue management",
    toolCount: "150+",
    statusKey: "gori",
  },
  {
    id: "cyberbox",
    name: "cyberbox",
    description: "Hunt orchestration, hypothesis management, CVE intel",
    toolCount: "72",
    statusKey: "cyberbox",
  },
  {
    id: "plugin",
    name: "plugin-center",
    description: "Tool installation and capability management",
    toolCount: "12",
    statusKey: "plugin",
  },
];

export default function MCP() {
  const [goriStatus, setGoriStatus] = useState<GoriStatus | null>(null);
  const [health, setHealth]         = useState<HealthData | null>(null);
  const [caps, setCaps]             = useState<Capability[]>([]);
  const [packCount, setPackCount]   = useState(0);
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function load() {
    setLoading(true);
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
    try {
      const [goriRes, healthRes, projRes, packRes] = await Promise.all([
        fetch("/api/v1/gori/status", { headers }),
        fetch("/api/v1/health", { headers }),
        fetch("/api/v1/projects", { headers }),
        fetch("/api/v1/knowledge/packs", { headers }),
      ]);

      const gori: GoriStatus  = goriRes.ok  ? await goriRes.json()  : { reachable: false };
      const hlth: HealthData  = healthRes.ok ? await healthRes.json() : { status: "unknown" };
      const projs             = projRes.ok   ? await projRes.json()  : [];
      const packs: Pack[]     = packRes.ok   ? await packRes.json()  : [];
      const pid: string       = projs[0]?.id ?? "";

      setGoriStatus(gori);
      setHealth(hlth);
      setPackCount(Array.isArray(packs) ? packs.length : 0);

      if (pid) {
        const capRes = await fetch(`/api/v1/projects/${pid}/capabilities`, { headers });
        const data: Capability[] = capRes.ok ? await capRes.json() : [];
        setCaps(Array.isArray(data) ? data : []);
      }
    } catch {
      // keep state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    load().then(() => { if (cancelled) showToast; });
    return () => { cancelled = true; };
  }, []);

  function serverOnline(key: MCPServer["statusKey"]): boolean | null {
    if (key === "gori")     return goriStatus?.reachable ?? null;
    if (key === "cyberbox") return health ? health.status === "ok" || health.status === "healthy" : null;
    return true; // plugin-center always configured
  }

  const totalCaps = caps.length;

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
          <Bot size={16} />
          <span>MCP Center</span>
          <small>{MCP_SERVERS.length} servers</small>
        </div>
        <div className="toolbar-actions">
          <button className="action-btn" onClick={load} disabled={loading}>
            <RefreshCw size={13} style={{ marginRight: 4 }} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading MCP status…</div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* Stat row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 28 }}>
            {[
              { label: "Connected Servers", value: MCP_SERVERS.filter((s) => serverOnline(s.statusKey) !== false).length.toString() },
              { label: "Capability Tokens",  value: totalCaps.toString() },
              { label: "Knowledge Packs",    value: packCount.toString() },
            ].map((stat) => (
              <div key={stat.label} style={{
                background: "var(--panel)", border: "1px solid var(--border)",
                borderRadius: 6, padding: "14px 16px",
              }}>
                <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                  {stat.label}
                </div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 22, color: "var(--accent)", fontWeight: 700 }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* MCP Servers */}
          <div style={{
            fontSize: 12, fontWeight: 600, color: "var(--muted)",
            marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
          }}>
            MCP Servers
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
            {MCP_SERVERS.map((server) => {
              const online = serverOnline(server.statusKey);
              return (
                <div key={server.id} style={{
                  background: "var(--panel)", border: "1px solid var(--border)",
                  borderRadius: 6, padding: "16px 20px",
                  display: "flex", alignItems: "center", gap: 16,
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: online === null ? "var(--muted)" : online ? "var(--good)" : "var(--bad)",
                    boxShadow: online ? "0 0 6px var(--good)" : undefined,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <code className="mono-cell" style={{ color: "var(--accent)", fontWeight: 700, fontSize: 13 }}>
                        {server.name}
                      </code>
                      <code className="type-badge" style={{
                        color: online === null ? "var(--muted)" : online ? "var(--good)" : "var(--bad)",
                        borderColor: online === null ? "var(--border)" : online ? "var(--good)" : "var(--bad)",
                      }}>
                        {online === null ? "unknown" : online ? "online" : "offline"}
                      </code>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{server.description}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 20, color: "var(--text)", fontWeight: 600 }}>
                      {server.toolCount}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>tools</span>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {online ? (
                      <CheckCircle2 size={16} color="var(--good)" />
                    ) : (
                      <XCircle size={16} color={online === null ? "var(--muted)" : "var(--bad)"} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Gori details */}
          {goriStatus && (
            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: "var(--muted)",
                marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
              }}>
                Gori Connection Details
              </div>
              <div style={{
                background: "var(--panel)", border: "1px solid var(--border)",
                borderRadius: 6, padding: "14px 18px",
                display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12,
              }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Reachable</div>
                  <span style={{ color: goriStatus.reachable ? "var(--good)" : "var(--bad)", fontWeight: 600, fontSize: 12 }}>
                    {goriStatus.reachable ? "yes" : "no"}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>URL</div>
                  <code className="mono-cell" style={{ fontSize: 11 }}>
                    {goriStatus.gori_url ?? "—"}
                  </code>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>PAT</div>
                  <span style={{ color: goriStatus.pat_configured ? "var(--good)" : "var(--warn)", fontSize: 12, fontWeight: 600 }}>
                    {goriStatus.pat_configured ? "configured" : "not set"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Capability Tokens section */}
          <div style={{
            fontSize: 12, fontWeight: 600, color: "var(--muted)",
            marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>Capability Tokens ({totalCaps})</span>
            <Link
              to="/system/secrets"
              style={{
                fontSize: 11, color: "var(--accent)", textDecoration: "none",
                fontFamily: "JetBrains Mono, monospace", textTransform: "none",
              }}
            >
              Manage in Secrets →
            </Link>
          </div>

          {caps.length === 0 ? (
            <div className="empty-state-block">
              <p>No capability tokens issued.{" "}
                <Link to="/system/secrets" style={{ color: "var(--accent)" }}>Issue one in Secrets.</Link>
              </p>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Type</th>
                    <th>Permissions</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {caps.slice(0, 10).map((cap) => (
                    <tr key={cap.id} className="data-row">
                      <td><code className="mono-cell" style={{ fontSize: 11 }}>{cap.subject_id.slice(0, 20)}{cap.subject_id.length > 20 ? "…" : ""}</code></td>
                      <td><code className="type-badge">{cap.subject_type}</code></td>
                      <td>
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--muted)" }}>
                          {(cap.permissions ?? []).join(", ") || "—"}
                        </span>
                      </td>
                      <td className="time-cell" style={{ color: "var(--muted)" }}>
                        {cap.expires_at ? new Date(cap.expires_at).toLocaleDateString() : "never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {caps.length > 10 && (
                <div style={{ padding: "8px 16px", fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
                  Showing 10 of {caps.length} —{" "}
                  <Link to="/system/secrets" style={{ color: "var(--accent)" }}>view all</Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
