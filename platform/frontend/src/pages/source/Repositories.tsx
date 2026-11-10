import { useEffect, useState } from "react";
import { GitBranch, Filter } from "lucide-react";
import { getApiKey } from "../../lib/api";

type KnowledgePack = {
  id: string;
  name: string;
  version: string;
  description: string;
  kind: string;
  size_bytes: number;
};

type Execution = {
  id: string;
  kind: string;
  status: string;
  risk_class: string | null;
  created_at: string;
  finished_at: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  running: "var(--info)",
  completed: "var(--good)",
  failed: "var(--bad)",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function Repositories() {
  const [packs, setPacks] = useState<KnowledgePack[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

    async function init() {
      try {
        const [packsResp, execResp] = await Promise.all([
          fetch("/api/v1/knowledge/packs", { headers }),
          fetch("/api/v1/executions?limit=50", { headers }),
        ]);
        const packsData = packsResp.ok ? await packsResp.json() : [];
        const execData = execResp.ok ? await execResp.json() : [];
        if (!cancelled) {
          setPacks(packsData);
          setExecutions(
            (execData as Execution[]).filter(
              (e) => e.kind === "raptor_scan" || e.kind === "wordfence_scan"
            )
          );
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const filtered = filter
    ? packs.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
    : packs;

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <GitBranch size={16} />
          <span>Repositories</span>
          <small>{filtered.length} packs</small>
        </div>
        <div className="toolbar-actions">
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input
              placeholder="Search packs…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {/* Knowledge packs grid */}
          {filtered.length === 0 ? (
            <div className="empty-state-block">
              <p>No knowledge packs loaded — add source repositories via the CLI.</p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 12,
                marginBottom: 32,
              }}
            >
              {filtered.map((pack) => (
                <div
                  key={pack.id}
                  style={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 13, color: "var(--text)" }}>{pack.name}</strong>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <code className="type-badge">{pack.version}</code>
                      <code className="type-badge">{pack.kind}</code>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
                    {pack.description || "No description."}
                  </p>
                  <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                    {formatBytes(pack.size_bytes)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Source Scan Queue */}
          <div style={{ marginTop: 8 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--muted)",
                marginBottom: 10,
              }}
            >
              Source Scan Queue
            </div>
            {executions.length === 0 ? (
              <div className="empty-state-block" style={{ padding: "16px 0" }}>
                <p>No source scans in queue.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Started</th>
                    <th>Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((e) => (
                    <tr key={e.id} className="data-row">
                      <td><code className="mono-cell">{e.id.slice(0, 14)}…</code></td>
                      <td><code className="type-badge">{e.kind}</code></td>
                      <td>
                        <span className="sev-badge" style={{ color: STATUS_COLOR[e.status] ?? "var(--muted)" }}>
                          {e.status}
                        </span>
                      </td>
                      <td>
                        {e.risk_class
                          ? <code className="type-badge">{e.risk_class}</code>
                          : <span className="muted-cell">—</span>
                        }
                      </td>
                      <td className="time-cell">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="time-cell">{e.finished_at ? new Date(e.finished_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
