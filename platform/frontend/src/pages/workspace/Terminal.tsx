import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, RefreshCw } from "lucide-react";
import { fetchProjects, getApiKey } from "../../lib/api";

type Exec = { id: string; kind: string; status: string; created_at: string; output: string | null; };

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function statusColor(s: string): string {
  if (s === "running") return "var(--warn)";
  if (s === "done" || s === "completed") return "var(--good)";
  if (s === "failed" || s === "error") return "var(--bad)";
  return "var(--muted)";
}

export default function TerminalPage() {
  const [projectId, setProjectId] = useState("");
  const [execs, setExecs] = useState<Exec[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedExec, setSelectedExec] = useState<Exec | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadExecs(pid: string, quiet = false) {
    if (!quiet) setSpinning(true);
    try {
      const r = await fetch(`/api/v1/projects/${encodeURIComponent(pid)}/executions?limit=50`, {
        headers: { "X-Api-Key": getApiKey() },
      });
      if (r.ok) {
        const data = await r.json();
        setExecs(Array.isArray(data) ? data : []);
      }
    } finally {
      if (!quiet) setSpinning(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchProjects().then(async (ps) => {
      if (cancelled || !ps.length) { setLoading(false); return; }
      const pid = ps[0].id;
      setProjectId(pid);
      await loadExecs(pid);
      if (!cancelled) setLoading(false);
      intervalRef.current = setInterval(() => loadExecs(pid, true), 8000);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (!selectedId || !projectId) return;
    const exec = execs.find((e) => e.id === selectedId);
    if (exec) setSelectedExec(exec);

    if (!exec || exec.status !== "running") return;
    const timer = setInterval(async () => {
      const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/executions/${encodeURIComponent(selectedId)}`, {
        headers: { "X-Api-Key": getApiKey() },
      });
      if (r.ok) {
        const data: Exec = await r.json();
        setSelectedExec(data);
        setExecs((prev) => prev.map((e) => (e.id === data.id ? data : e)));
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [selectedId, projectId, execs]);

  function selectExec(exec: Exec) {
    setSelectedId(exec.id);
    setSelectedExec(exec);
  }

  const filtered = filter
    ? execs.filter((e) => e.kind.toLowerCase().includes(filter.toLowerCase()) || e.id.toLowerCase().includes(filter.toLowerCase()))
    : execs;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="page-toolbar">
        <div className="page-title">
          <TerminalIcon size={16} />
          <span>Terminal</span>
          <small>{execs.length} executions</small>
        </div>
        <div className="toolbar-actions">
          <div className="filter-input-wrap">
            <input placeholder="Filter by kind or id…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <button
            className="action-btn"
            onClick={() => projectId && loadExecs(projectId)}
            style={spinning ? { color: "var(--accent)" } : {}}
          >
            <RefreshCw size={13} style={spinning ? { animation: "spin 0.8s linear infinite" } : {}} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading executions…</div>
      ) : (
        <div style={{ display: "flex", flex: 1, overflow: "hidden", borderTop: "1px solid var(--border)" }}>
          {/* Left list */}
          <div style={{ width: "30%", minWidth: 200, borderRight: "1px solid var(--border)", overflowY: "auto", background: "var(--panel)" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 24, color: "var(--muted)", fontSize: 12 }}>No executions yet.</div>
            ) : (
              filtered.map((exec) => (
                <div
                  key={exec.id}
                  onClick={() => selectExec(exec)}
                  style={{
                    padding: "10px 14px",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--border)",
                    borderLeft: selectedId === exec.id ? "2px solid var(--accent)" : "2px solid transparent",
                    background: selectedId === exec.id ? "var(--panel-2)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span className="type-badge" style={{ fontSize: 10 }}>{exec.kind}</span>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor(exec.status), flexShrink: 0 }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <code style={{ fontSize: 10, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {exec.id.slice(0, 12)}…
                    </code>
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>{timeAgo(exec.created_at)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Right output */}
          <div style={{ flex: 1, overflowY: "auto", background: "var(--bg)" }}>
            {!selectedExec ? (
              <div style={{ padding: 32, color: "var(--muted)", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                Select an execution to view its output.
              </div>
            ) : (
              <div style={{ padding: 16 }}>
                {selectedExec.status === "running" && (
                  <div style={{ marginBottom: 10, fontSize: 11, color: "var(--warn)", fontFamily: "'JetBrains Mono', monospace" }}>
                    ● Live — auto-refreshing…
                  </div>
                )}
                <pre style={{
                  whiteSpace: "pre-wrap", fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11, color: "var(--text)", margin: 0, lineHeight: 1.6,
                }}>
                  {selectedExec.output ?? "(no output)"}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
