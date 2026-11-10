import { useEffect, useState } from "react";
import { Activity, Filter, Download } from "lucide-react";
import { getApiKey } from "../../lib/api";

type GoriStatus = { reachable: boolean; gori_url?: string; pat_configured?: boolean; caido_project?: string };
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

export default function Traffic() {
  const [status, setStatus] = useState<GoriStatus | null>(null);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostFilter, setHostFilter] = useState("");
  const [limit, setLimit] = useState("100");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const key = getApiKey();
      const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
      try {
        const [statusRes, projectsRes] = await Promise.all([
          fetch("/api/v1/gori/status", { headers }),
          fetch("/api/v1/projects", { headers }),
        ]);
        const goriStatus: GoriStatus = statusRes.ok ? await statusRes.json() : { reachable: false };
        const projects = projectsRes.ok ? await projectsRes.json() : [];
        const pid = projects[0]?.id ?? "";
        if (cancelled) return;
        setStatus(goriStatus);
        setProjectId(pid);
        if (pid && goriStatus.reachable) {
          const flowsRes = await fetch(
            `/api/v1/projects/${pid}/gori/flows?host=${encodeURIComponent(hostFilter)}&limit=${limit}`,
            { headers }
          );
          const flowData = flowsRes.ok ? await flowsRes.json() : [];
          if (!cancelled) setFlows(Array.isArray(flowData) ? flowData : []);
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const r = await fetch(`/api/v1/projects/${projectId}/gori/import`, { method: "POST", headers });
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

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Activity size={16} />
          <span>Traffic</span>
          <small>{flows.length} flows</small>
        </div>
        <div className="toolbar-actions">
          {status && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)" }}>
              <span style={{
                display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                background: status.reachable ? "var(--good)" : "var(--bad)",
              }} />
              <span style={{ fontFamily: "JetBrains Mono, monospace" }}>
                {status.gori_url ?? "not set"}
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
          <button className="action-btn primary" onClick={doImport} disabled={importing || !projectId}>
            <Download size={13} />
            {importing ? "Importing…" : "Import"}
          </button>
          {importMsg && (
            <span style={{ fontSize: 11, color: "var(--good)", fontFamily: "JetBrains Mono, monospace" }}>
              {importMsg}
            </span>
          )}
        </div>
      </div>

      {status && !status.reachable && (
        <div style={{
          padding: "10px 20px", background: "#2d1a00", borderBottom: "1px solid var(--warn)",
          color: "var(--warn)", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
        }}>
          Caido not connected — set CYBERBOX_GORI_URL + CYBERBOX_GORI_PAT
        </div>
      )}

      {loading
        ? <div className="page-loading">Loading…</div>
        : flows.length === 0
          ? (
            <div className="empty-state-block">
              <p>
                {status?.reachable
                  ? "No flows captured yet. Browse through Caido to populate traffic."
                  : "Connect Caido to view proxy traffic."}
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
                        <code
                          className="type-badge"
                          style={{ color: METHOD_COLOR[f.method] ?? "var(--info)" }}
                        >
                          {f.method}
                        </code>
                      </td>
                      <td>
                        <span
                          className="mono-cell"
                          title={f.url}
                          style={{ cursor: "default" }}
                        >
                          {f.url.length > 60 ? f.url.slice(0, 60) + "…" : f.url}
                        </span>
                      </td>
                      <td>
                        <span
                          className="sev-badge"
                          style={{ color: statusColor(f.status_code) }}
                        >
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
    </div>
  );
}
