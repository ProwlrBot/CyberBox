import { useEffect, useRef, useState } from "react";
import { Activity, Filter, Download, ExternalLink, Monitor } from "lucide-react";
import { getApiKey } from "../../lib/api";

type GoriStatus = {
  reachable: boolean;
  caido_local: boolean;
  caido_local_port: number;
  gori_url?: string;
  pat_configured?: boolean;
  caido_project?: { id?: string; name?: string };
};
type Flow = { id: string; method: string; url: string; status_code: number; created_at: string };

const METHOD_COLOR: Record<string, string> = {
  GET: "var(--info)", POST: "var(--warn)", PUT: "#c084fc",
  DELETE: "var(--bad)", PATCH: "#fb923c", HEAD: "var(--muted)", OPTIONS: "var(--muted)",
};

function statusColor(code: number): string {
  if (code >= 500) return "var(--bad)";
  if (code >= 400) return "var(--warn)";
  if (code >= 300) return "var(--info)";
  if (code >= 200) return "var(--good)";
  return "var(--muted)";
}

type Tab = "flows" | "caido";

export default function Traffic() {
  const [status, setStatus] = useState<GoriStatus | null>(null);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostFilter, setHostFilter] = useState("");
  const [limit, setLimit] = useState("100");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [projectId, setProjectId] = useState("");
  const [tab, setTab] = useState<Tab>("flows");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const key = getApiKey();
      const h: Record<string, string> = key ? { "X-Api-Key": key } : {};
      try {
        const [statusRes, projectsRes] = await Promise.all([
          fetch("/api/v1/gori/status", { headers: h }),
          fetch("/api/v1/projects", { headers: h }),
        ]);
        const goriStatus: GoriStatus = statusRes.ok
          ? await statusRes.json()
          : { reachable: false, caido_local: false, caido_local_port: 8080 };
        const projects = projectsRes.ok ? await projectsRes.json() : [];
        const pid = projects[0]?.id ?? "";
        if (cancelled) return;
        setStatus(goriStatus);
        setProjectId(pid);
        // Auto-switch to Caido tab if local instance detected and no flows yet
        if (goriStatus.caido_local && flows.length === 0) setTab("caido");
        if (pid && goriStatus.pat_configured) {
          const flowsRes = await fetch(
            `/api/v1/projects/${pid}/gori/flows?host=${encodeURIComponent(hostFilter)}&limit=${limit}`,
            { headers: h }
          );
          const flowData = flowsRes.ok ? await flowsRes.json() : [];
          if (!cancelled) {
            const arr = Array.isArray(flowData) ? flowData : [];
            setFlows(arr);
            if (arr.length > 0) setTab("flows");
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [hostFilter, limit]);

  async function doImport() {
    if (!projectId) return;
    setImporting(true);
    setImportMsg("");
    const key = getApiKey();
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const r = await fetch(`/api/v1/projects/${projectId}/gori/import`, { method: "POST", headers: h });
      if (r.ok) {
        const d = await r.json();
        setImportMsg(`Imported ${d.imported ?? 0} findings`);
      } else {
        setImportMsg("Import failed");
      }
    } catch {
      setImportMsg("Import error");
    } finally {
      setImporting(false);
    }
  }

  const caidoPort = status?.caido_local_port ?? 8080;
  const caidoUrl  = `http://localhost:${caidoPort}`;

  return (
    <div className="page-targets" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── toolbar ── */}
      <div className="page-toolbar">
        <div className="page-title">
          <Activity size={16} />
          <span>Traffic</span>
          {tab === "flows" && <small>{flows.length} flows</small>}
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setTab("flows")}
            style={{
              padding: "4px 12px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)",
              background: tab === "flows" ? "var(--accent)" : "var(--panel-2)",
              color: tab === "flows" ? "#000" : "var(--text)", cursor: "pointer",
            }}
          >
            Flows
          </button>
          <button
            onClick={() => setTab("caido")}
            style={{
              padding: "4px 12px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)",
              background: tab === "caido" ? "var(--accent)" : "var(--panel-2)",
              color: tab === "caido" ? "#000" : "var(--text)", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <Monitor size={12} />
            Caido UI
            {status?.caido_local && (
              <span style={{
                display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                background: "var(--good)", marginLeft: 2,
              }} />
            )}
          </button>
        </div>

        {tab === "flows" && (
          <div className="toolbar-actions">
            {/* gori connection status */}
            {status && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)" }}>
                <span style={{
                  display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                  background: status.reachable ? "var(--good)" : "var(--bad)",
                }} />
                <span style={{ fontFamily: "JetBrains Mono, monospace" }}>
                  {status.pat_configured ? (status.gori_url ?? "gori") : "PAT not set"}
                </span>
                {status.pat_configured && (
                  <span style={{ color: "var(--good)", fontSize: 10 }}>PAT ✓</span>
                )}
              </div>
            )}
            <div className="filter-input-wrap">
              <Filter size={13} />
              <input
                placeholder="Filter by host…"
                value={hostFilter}
                onChange={(e) => setHostFilter(e.target.value)}
              />
            </div>
            <select
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              style={{
                height: 32, border: "1px solid var(--border)", background: "var(--panel-2)",
                color: "var(--text)", fontSize: 12, padding: "0 8px", borderRadius: 4,
              }}
            >
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
            <button
              className="action-btn primary"
              onClick={doImport}
              disabled={importing || !projectId || !status?.pat_configured}
              title={!status?.pat_configured ? "Set CYBERBOX_GORI_PAT to enable import" : ""}
            >
              <Download size={13} />
              {importing ? "Importing…" : "Import findings"}
            </button>
            {importMsg && (
              <span style={{ fontSize: 11, color: "var(--good)", fontFamily: "JetBrains Mono, monospace" }}>
                {importMsg}
              </span>
            )}
          </div>
        )}

        {tab === "caido" && (
          <div className="toolbar-actions">
            <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "JetBrains Mono, monospace" }}>
              {caidoUrl}
            </span>
            <a
              href={caidoUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex", alignItems: "center", gap: 4, fontSize: 11,
                color: "var(--accent)", textDecoration: "none",
              }}
            >
              <ExternalLink size={11} /> Open in browser
            </a>
          </div>
        )}
      </div>

      {/* ── Caido tab ── */}
      {tab === "caido" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {status?.caido_local ? (
            <iframe
              ref={iframeRef}
              src={caidoUrl}
              style={{ flex: 1, border: "none", width: "100%", height: "100%" }}
              title="Caido UI"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation"
            />
          ) : (
            <div className="empty-state-block" style={{ flex: 1 }}>
              <Monitor size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p style={{ marginBottom: 8 }}>Caido is not running on port {caidoPort}.</p>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>
                Start Caido with:
              </p>
              <code style={{
                display: "block", marginTop: 8, padding: "8px 12px",
                background: "var(--panel)", borderRadius: 4,
                fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                color: "var(--accent)", border: "1px solid var(--border)",
              }}>
                caido-cli --proxy-listen 0.0.0.0:8080 --ui-listen 0.0.0.0:{caidoPort} --no-open
              </code>
            </div>
          )}
        </div>
      )}

      {/* ── Flows tab ── */}
      {tab === "flows" && (
        <>
          {!status?.pat_configured && (
            <div style={{
              padding: "10px 20px", background: "#2d1a00", borderBottom: "1px solid var(--warn)",
              color: "var(--warn)", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
            }}>
              Gori PAT not configured — set <code>CYBERBOX_GORI_PAT</code> + <code>CYBERBOX_GORI_URL</code> env vars to pull flows. Caido UI is in the Caido UI tab.
            </div>
          )}

          {loading
            ? <div className="page-loading">Loading…</div>
            : flows.length === 0
              ? (
                <div className="empty-state-block">
                  <p>
                    {status?.pat_configured
                      ? "No flows captured yet. Browse through Caido to populate traffic."
                      : "Configure CYBERBOX_GORI_PAT to pull flows, or browse the Caido UI tab."}
                  </p>
                </div>
              )
              : (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>URL</th>
                        <th>Status</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flows.map((f) => (
                        <tr key={f.id} className="data-row">
                          <td>
                            <code className="type-badge" style={{ color: METHOD_COLOR[f.method] ?? "var(--info)" }}>
                              {f.method}
                            </code>
                          </td>
                          <td>
                            <span className="mono-cell" title={f.url} style={{ cursor: "default" }}>
                              {f.url.length > 70 ? f.url.slice(0, 70) + "…" : f.url}
                            </span>
                          </td>
                          <td>
                            <span className="sev-badge" style={{ color: statusColor(f.status_code) }}>
                              {f.status_code}
                            </span>
                          </td>
                          <td className="time-cell">
                            {new Date(f.created_at).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </>
      )}
    </div>
  );
}
