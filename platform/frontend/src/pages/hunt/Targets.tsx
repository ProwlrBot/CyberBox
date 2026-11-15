import { useEffect, useState } from "react";
import { Filter, Plus, Target as TargetIcon, X } from "lucide-react";
import { fetchProjects, fetchTargets, createTarget, type TargetType, type TargetStatus } from "../../lib/api";

const STATUS_COLOR: Record<string, string> = {
  "in-scope": "var(--good)", candidate: "var(--info)",
  excluded: "var(--muted)", "out-of-scope": "var(--bad)", archived: "var(--muted)",
};
const TARGET_TYPES: TargetType[] = ["domain", "cidr", "ip", "url", "repository", "package", "cloud-resource"];
const STATUSES: TargetStatus[] = ["candidate", "in-scope", "excluded", "out-of-scope", "archived"];

type TargetRow = { id: string; name: string; target_type: string; pattern: string; status: string; source: string; updated_at: string };

export default function Targets() {
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<{ name: string; target_type: TargetType; pattern: string; status: TargetStatus }>(
    { name: "", target_type: "domain", pattern: "", status: "candidate" });

  async function refresh(pid: string) {
    const data = await fetchTargets(pid);
    setRows(data);
  }

  useEffect(() => {
    let cancelled = false;
    fetchProjects().then(async (projects) => {
      if (cancelled || !projects.length) { setLoading(false); return; }
      setProjectId(projects[0].id);
      try { await refresh(projects[0].id); } finally { if (!cancelled) setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function submit() {
    if (!projectId || !form.name.trim() || !form.pattern.trim()) {
      setError("Name and pattern are required."); return;
    }
    setSaving(true); setError("");
    try {
      await createTarget(projectId, { name: form.name.trim(), target_type: form.target_type, pattern: form.pattern.trim(), status: form.status });
      setForm({ name: "", target_type: "domain", pattern: "", status: "candidate" });
      setAdding(false);
      await refresh(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add target.");
    } finally {
      setSaving(false);
    }
  }

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
          <button className="action-btn primary" onClick={() => { setAdding((v) => !v); setError(""); }} disabled={!projectId}>
            {adding ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add target</>}
          </button>
        </div>
      </div>

      {adding && (
        <div className="add-target-form" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", padding: "12px 14px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, margin: "0 0 12px 0" }}>
          <label style={fieldStyle}><span style={lblStyle}>Name</span>
            <input value={form.name} autoFocus placeholder="Acme prod" onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          </label>
          <label style={fieldStyle}><span style={lblStyle}>Type</span>
            <select value={form.target_type} onChange={(e) => setForm({ ...form, target_type: e.target.value as TargetType })} style={inputStyle}>
              {TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={{ ...fieldStyle, flex: 2, minWidth: 220 }}><span style={lblStyle}>Pattern</span>
            <input value={form.pattern} placeholder="*.example.com  ·  10.0.0.0/24  ·  https://app.example.com" onChange={(e) => setForm({ ...form, pattern: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} />
          </label>
          <label style={fieldStyle}><span style={lblStyle}>Status</span>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TargetStatus })} style={inputStyle}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button className="action-btn primary" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          {error && <div style={{ flexBasis: "100%", color: "var(--bad)", fontSize: 12 }}>{error}</div>}
        </div>
      )}

      {loading
        ? <div className="page-loading">Loading targets…</div>
        : filtered.length === 0
          ? <div className="empty-state-block"><p>{rows.length === 0 ? "No targets yet. Click “Add target” to begin scoping." : "No targets match that filter."}</p></div>
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

const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 130 };
const lblStyle: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)" };
const inputStyle: React.CSSProperties = { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", padding: "6px 8px", fontSize: 12 };
