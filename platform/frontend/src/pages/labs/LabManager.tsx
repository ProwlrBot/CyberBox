import { useEffect, useState } from "react";
import { FlaskConical, Filter, X as XIcon } from "lucide-react";
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

type Project = { id: string; name: string; slug: string };

const STATUS_COLOR: Record<string, string> = {
  running: "var(--warn)",
  completed: "var(--good)",
  failed: "var(--bad)",
  pending: "var(--muted)",
  queued: "var(--info)",
};

const TABS = ["All", "Scans", "Wordfence", "Raptor"] as const;
type Tab = (typeof TABS)[number];

function tabFilter(kind: string, tab: Tab): boolean {
  if (tab === "All") return true;
  if (tab === "Scans") return kind === "scan";
  if (tab === "Wordfence") return kind === "wordfence";
  if (tab === "Raptor") return kind === "raptor";
  return true;
}

export default function LabManager() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("All");
  const [filter, setFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [target, setTarget] = useState("");
  const [profile, setProfile] = useState("generic");
  const [launching, setLaunching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
    try {
      const [projRes, execRes] = await Promise.all([
        fetch("/api/v1/projects", { headers }),
        fetch("/api/v1/executions?limit=100", { headers }),
      ]);
      const projs: Project[] = projRes.ok ? await projRes.json() : [];
      const execs: Execution[] = execRes.ok ? await execRes.json() : [];
      setProjects(projs);
      setExecutions(execs);
    } catch {
      // keep existing state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

    async function fetchData() {
      try {
        const [projRes, execRes] = await Promise.all([
          fetch("/api/v1/projects", { headers }),
          fetch("/api/v1/executions?limit=100", { headers }),
        ]);
        const projs: Project[] = projRes.ok ? await projRes.json() : [];
        const execs: Execution[] = execRes.ok ? await execRes.json() : [];
        if (!cancelled) {
          setProjects(projs);
          setExecutions(execs);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(() => { if (!cancelled) load(); }, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  async function launchScan() {
    if (!target.trim()) return;
    const projectId = projects[0]?.id ?? "";
    if (!projectId) { setToast("No project loaded"); setTimeout(() => setToast(null), 3000); return; }
    setLaunching(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const r = await fetch(`/api/v1/projects/${projectId}/scans`, {
        method: "POST",
        headers,
        body: JSON.stringify({ target: target.trim(), profile: profile.trim() || "generic" }),
      });
      if (r.ok) {
        setToast("Scan launched successfully");
        setShowModal(false);
        setTarget("");
        setProfile("generic");
        await load();
      } else {
        const err = await r.json().catch(() => ({ message: r.statusText }));
        setToast(`Error: ${err?.message ?? r.statusText}`);
      }
    } catch (e) {
      setToast("Launch failed — check API connection");
    } finally {
      setLaunching(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  const rows = executions.filter((e) => {
    if (!tabFilter(e.kind, tab)) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return e.kind.includes(q) || e.status.includes(q) || (projectMap[e.project_id] ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="page-targets">
      {toast && (
        <div
          style={{
            position: "fixed", top: 16, right: 16, zIndex: 9999,
            background: "var(--panel-2)", border: "1px solid var(--accent)",
            color: "var(--accent)", padding: "10px 16px", borderRadius: 6,
            fontFamily: "JetBrains Mono, monospace", fontSize: 12,
          }}
        >
          {toast}
        </div>
      )}

      <div className="page-toolbar">
        <div className="page-title">
          <FlaskConical size={16} />
          <span>Lab Manager</span>
          <small>{rows.length}</small>
        </div>
        <div className="toolbar-actions">
          {TABS.map((t) => (
            <button
              key={t}
              className="action-btn"
              style={tab === t ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <button className="action-btn primary" onClick={() => setShowModal(true)}>
            + New Scan
          </button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading executions…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state-block">
          <p>No executions found. Launch a scan to get started.</p>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Project</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Started</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="data-row">
                  <td><code className="type-badge">{e.kind}</code></td>
                  <td className="muted-cell">{projectMap[e.project_id] ?? e.project_id.slice(0, 10)}</td>
                  <td>
                    <span style={{ color: STATUS_COLOR[e.status] ?? "var(--muted)", fontWeight: 500, fontSize: 12 }}>
                      {e.status}
                    </span>
                  </td>
                  <td className="muted-cell">{e.risk_class ?? "—"}</td>
                  <td className="time-cell">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="time-cell">{e.finished_at ? new Date(e.finished_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(ev) => ev.stopPropagation()} style={{ width: 420 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>New Scan</span>
              <button className="action-btn" style={{ padding: "2px 6px" }} onClick={() => setShowModal(false)}>
                <XIcon size={13} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Target (domain / URL)</label>
                <input
                  style={{
                    width: "100%", background: "var(--panel-2)", border: "1px solid var(--border)",
                    color: "var(--text)", padding: "7px 10px", borderRadius: 4, fontSize: 13,
                    fontFamily: "JetBrains Mono, monospace", boxSizing: "border-box",
                  }}
                  placeholder="https://example.com"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") launchScan(); }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Profile</label>
                <input
                  style={{
                    width: "100%", background: "var(--panel-2)", border: "1px solid var(--border)",
                    color: "var(--text)", padding: "7px 10px", borderRadius: 4, fontSize: 13,
                    fontFamily: "JetBrains Mono, monospace", boxSizing: "border-box",
                  }}
                  placeholder="generic"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                />
              </div>
              <button
                className="action-btn primary"
                style={{ alignSelf: "flex-end", padding: "7px 20px", fontSize: 13 }}
                disabled={launching || !target.trim()}
                onClick={launchScan}
              >
                {launching ? "Launching…" : "Launch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
