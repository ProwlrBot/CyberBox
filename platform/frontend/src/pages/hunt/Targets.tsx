import { useEffect, useState } from "react";
import { Filter, Plus, Target as TargetIcon } from "lucide-react";
import { fetchProjects, fetchTargets } from "../../lib/api";

const STATUS_COLOR: Record<string, string> = {
  "in-scope": "var(--good)", candidate: "var(--info)",
  excluded: "var(--muted)", "out-of-scope": "var(--bad)", archived: "var(--muted)",
};

type TargetRow = { id: string; name: string; target_type: string; pattern: string; status: string; source: string; updated_at: string };

export default function Targets() {
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchProjects().then(async (projects) => {
      if (cancelled || !projects.length) { setLoading(false); return; }
      const data = await fetchTargets(projects[0].id);
      if (!cancelled) { setRows(data); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = filter
    ? rows.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()) || r.pattern.toLowerCase().includes(filter.toLowerCase()))
    : rows;

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <TargetIcon size={16} />
          <span>Targets</span>
          <small>{filtered.length}</small>
        </div>
        <div className="toolbar-actions">
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input placeholder="Filter targets…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <button className="action-btn primary"><Plus size={14} /> Add target</button>
        </div>
      </div>

      {loading
        ? <div className="page-loading">Loading targets…</div>
        : filtered.length === 0
          ? <div className="empty-state-block"><p>No targets. Add your first target to begin scoping.</p></div>
          : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th><th>Type</th><th>Pattern</th>
                    <th>Status</th><th>Source</th><th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="data-row">
                      <td><strong>{t.name}</strong></td>
                      <td><code className="type-badge">{t.target_type}</code></td>
                      <td><code className="mono-cell">{t.pattern}</code></td>
                      <td>
                        <span className="status-dot" style={{ background: STATUS_COLOR[t.status] ?? "var(--muted)" }} />
                        {t.status}
                      </td>
                      <td className="muted-cell">{t.source}</td>
                      <td className="time-cell">{new Date(t.updated_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}
