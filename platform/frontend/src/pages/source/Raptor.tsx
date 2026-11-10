import { useEffect, useState } from "react";
import { Code2, Filter } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Execution = {
  id: string;
  project_id: string;
  kind: string;
  status: string;
  risk_class: string | null;
  created_at: string;
  finished_at: string | null;
  error: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  running: "var(--info)",
  completed: "var(--good)",
  failed: "var(--bad)",
};

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export default function Raptor() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoPath, setRepoPath] = useState("");
  const [focus, setFocus] = useState("");
  const [launching, setLaunching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  async function loadExecutions() {
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
    try {
      const r = await fetch("/api/v1/executions?limit=50", { headers });
      const data = r.ok ? await r.json() : [];
      setExecutions((data as Execution[]).filter((e) => e.kind === "raptor_scan"));
    } catch {
      setExecutions([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

    async function init() {
      try {
        const pResp = await fetch("/api/v1/projects", { headers });
        const projects = pResp.ok ? await pResp.json() : [];
        if (cancelled) return;
        const r = await fetch("/api/v1/executions?limit=50", { headers });
        const data = r.ok ? await r.json() : [];
        if (!cancelled) {
          setExecutions((data as Execution[]).filter((e) => e.kind === "raptor_scan"));
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  async function handleLaunch() {
    if (!repoPath.trim()) return;
    setLaunching(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const pResp = await fetch("/api/v1/projects", { headers: key ? { "X-Api-Key": key } : {} });
      const projects = pResp.ok ? await pResp.json() : [];
      const projectId = projects[0]?.id ?? "";
      if (!projectId) { setToast("No project loaded"); setLaunching(false); return; }

      const body: Record<string, string> = { repo_path: repoPath.trim() };
      if (focus.trim()) body.focus = focus.trim();

      const r = await fetch(`/api/v1/projects/${projectId}/raptor-scan`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const result = r.ok ? await r.json() : null;
      if (result?.execution_id) {
        setToast(`Launched — execution ${result.execution_id.slice(0, 12)}…`);
        setRepoPath("");
        setFocus("");
        await loadExecutions();
      } else {
        setToast("Launch failed — check API key and project");
      }
    } catch {
      setToast("Launch failed — network error");
    }
    setLaunching(false);
    setTimeout(() => setToast(null), 4000);
  }

  const filtered = filter
    ? executions.filter((e) =>
        e.id.toLowerCase().includes(filter.toLowerCase()) ||
        (e.status ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        (e.risk_class ?? "").toLowerCase().includes(filter.toLowerCase())
      )
    : executions;

  return (
    <div className="page-targets">
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderLeft: "3px solid var(--accent)",
            padding: "10px 16px",
            borderRadius: 6,
            fontSize: 13,
            color: "var(--text)",
            zIndex: 1000,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {toast}
        </div>
      )}

      <div className="page-toolbar">
        <div className="page-title">
          <Code2 size={16} />
          <span>Raptor</span>
          <small>{executions.length}</small>
        </div>
        <div className="toolbar-actions">
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input
              placeholder="Filter executions…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Scan launch form */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
          display: "flex",
          gap: 10,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "2 1 240px", display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Repo Path
          </label>
          <input
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "6px 10px",
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
              outline: "none",
            }}
            placeholder="/path/to/repo or git URL"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleLaunch(); }}
          />
        </div>
        <div style={{ flex: "2 1 200px", display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Focus (optional)
          </label>
          <input
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "6px 10px",
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
              outline: "none",
            }}
            placeholder="e.g. auth XSS injection"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleLaunch(); }}
          />
        </div>
        <button
          className="action-btn primary"
          style={{ height: 32, alignSelf: "flex-end" }}
          disabled={!repoPath.trim() || launching}
          onClick={handleLaunch}
        >
          {launching ? "Launching…" : "Launch scan"}
        </button>
      </div>

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state-block">
          <p>No Raptor scans yet — enter a repo path above and launch.</p>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Execution ID</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="data-row">
                  <td><code className="mono-cell">{e.id.slice(0, 16)}…</code></td>
                  <td>
                    <span
                      className="sev-badge"
                      style={{ color: STATUS_COLOR[e.status] ?? "var(--muted)" }}
                    >
                      {e.status}
                    </span>
                  </td>
                  <td>
                    {e.risk_class
                      ? <code className="type-badge">{e.risk_class}</code>
                      : <span className="muted-cell">—</span>
                    }
                  </td>
                  <td className="time-cell">{formatTime(e.created_at)}</td>
                  <td className="time-cell">{formatTime(e.finished_at)}</td>
                  <td className="mono-cell" style={{ color: e.error ? "var(--bad)" : "var(--muted)" }}>
                    {e.error ?? "—"}
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
