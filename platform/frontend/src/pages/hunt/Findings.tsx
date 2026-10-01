import { useEffect, useState } from "react";
import { Filter, Flag } from "lucide-react";
import { fetchProjects, fetchFindings } from "../../lib/api";

const SEV_COLOR: Record<string, string> = {
  critical: "var(--bad)", high: "var(--warn)", medium: "#fcd34d",
  low: "var(--good)", info: "var(--info)",
};

type Finding = { id: string; name: string; severity: string; category: string; cve: string | null; host: string; status: string; verified: boolean; detected_at: string };

export default function Findings() {
  const [rows, setRows] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchProjects().then(async (p) => {
      if (cancelled || !p.length) { setLoading(false); return; }
      const data = await fetchFindings(p[0].id);
      if (!cancelled) { setRows(data); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = filter
    ? rows.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()) || (r.host ?? "").toLowerCase().includes(filter.toLowerCase()))
    : rows;

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Flag size={16} />
          <span>Findings</span>
          <small>{filtered.length}</small>
        </div>
        <div className="toolbar-actions">
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input placeholder="Filter findings…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      </div>

      {loading
        ? <div className="page-loading">Loading…</div>
        : filtered.length === 0
          ? <div className="empty-state-block"><p>No findings yet. Run a scan to discover vulnerabilities.</p></div>
          : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Severity</th><th>Name</th><th>Category</th>
                    <th>CVE</th><th>Host</th><th>Status</th><th>Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr key={f.id} className="data-row" style={{ borderLeft: `3px solid ${SEV_COLOR[f.severity] ?? "var(--muted)"}` }}>
                      <td><span className="sev-badge" style={{ color: SEV_COLOR[f.severity] ?? "var(--muted)" }}>{f.severity}</span></td>
                      <td><strong>{f.name}</strong></td>
                      <td className="muted-cell">{f.category}</td>
                      <td><code className="mono-cell">{f.cve ?? "—"}</code></td>
                      <td className="mono-cell">{f.host}</td>
                      <td>{f.status}</td>
                      <td className="time-cell">{new Date(f.detected_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}
