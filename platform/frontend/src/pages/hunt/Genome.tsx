import { useEffect, useState } from "react";
import { Network, Filter, Upload, X as XIcon, AlertTriangle, Lock } from "lucide-react";
import {
  fetchProjects, fetchGenomeSummary, fetchGenomeEndpoints, ingestOpenapi,
  type GenomeEndpoint,
} from "../../lib/api";

type Summary = {
  by_source: Array<{ source: string; n: number; auth_ct: number }>;
  hosts: string[]; drift_count: number;
};

const METHOD_COLOR: Record<string, string> = {
  GET: "var(--good)", POST: "var(--accent)", PUT: "var(--warn)",
  PATCH: "var(--warn)", DELETE: "var(--bad)",
};

export default function Genome() {
  const [projectId, setProjectId] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [endpoints, setEndpoints] = useState<GenomeEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [driftOnly, setDriftOnly] = useState(false);
  const [showIngest, setShowIngest] = useState(false);
  const [toast, setToast] = useState("");

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3500); }

  async function load(pid: string, drift: boolean) {
    const [sum, eps] = await Promise.all([
      fetchGenomeSummary(pid),
      fetchGenomeEndpoints(pid, { drift }),
    ]);
    setSummary(sum);
    setEndpoints(eps);
  }

  useEffect(() => {
    let cancelled = false;
    fetchProjects().then(async (ps) => {
      if (cancelled || !ps.length) { setLoading(false); return; }
      const pid = ps[0].id;
      setProjectId(pid);
      await load(pid, false);
      if (!cancelled) setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function toggleDrift() {
    const next = !driftOnly;
    setDriftOnly(next);
    setEndpoints(await fetchGenomeEndpoints(projectId, { drift: next }));
  }

  const total = summary?.by_source.reduce((s, r) => s + r.n, 0) ?? 0;
  const authed = summary?.by_source.reduce((s, r) => s + (r.auth_ct ?? 0), 0) ?? 0;

  const filtered = filter
    ? endpoints.filter((e) =>
        e.path.toLowerCase().includes(filter.toLowerCase()) ||
        e.host.toLowerCase().includes(filter.toLowerCase()) ||
        e.method.toLowerCase().includes(filter.toLowerCase()))
    : endpoints;

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Network size={16} />
          <span>API Genome</span>
          <small>{total} endpoints</small>
        </div>
        <div className="toolbar-actions">
          <button className="action-btn" style={driftOnly ? { color: "var(--warn)", borderColor: "var(--warn)" } : {}} onClick={toggleDrift}>
            <AlertTriangle size={13} /> Drift{summary?.drift_count ? ` (${summary.drift_count})` : ""}
          </button>
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input placeholder="Filter endpoints…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {projectId && (
            <button className="action-btn primary" onClick={() => setShowIngest(true)}>
              <Upload size={13} /> Ingest OpenAPI
            </button>
          )}
        </div>
      </div>

      {!loading && summary && (
        <div style={{ display: "flex", gap: 1, borderBottom: "1px solid var(--border)", background: "var(--border)", flexShrink: 0 }}>
          {[
            { label: "Endpoints", val: total, color: "var(--text)" },
            { label: "Authenticated", val: authed, color: "var(--info)" },
            { label: "Hosts", val: summary.hosts.length, color: "var(--text)" },
            { label: "Drift", val: summary.drift_count, color: summary.drift_count ? "var(--warn)" : "var(--muted)" },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ flex: 1, background: "var(--panel)", padding: "8px 16px" }}>
              <div style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="page-loading">Loading genome…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state-block">
          <p>{total === 0
            ? "No endpoints mapped yet — ingest an OpenAPI spec (or capture traffic via HAR/Burp/Caido) to build the inventory."
            : driftOnly ? "No drifted endpoints — the surface matches the last snapshot."
            : "No endpoints match the filter."}</p>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Method</th><th>Host</th><th>Path</th><th>Source</th><th>Auth</th><th>Drift</th></tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                let drift: string[] = [];
                try { drift = JSON.parse(e.drift_flags || "[]"); } catch { /* ignore */ }
                return (
                  <tr key={e.id} className="data-row">
                    <td><span className="sev-badge" style={{ color: METHOD_COLOR[e.method] ?? "var(--muted)" }}>{e.method}</span></td>
                    <td className="mono-cell">{e.host}</td>
                    <td><code className="mono-cell" style={{ fontSize: 11, color: "var(--text)" }}>{e.path_template || e.path}</code></td>
                    <td><span className="type-badge">{e.source}</span></td>
                    <td>{e.auth_required ? <Lock size={12} style={{ color: "var(--info)" }} /> : <span className="muted-cell">—</span>}</td>
                    <td>{drift.length ? <span className="sev-badge" style={{ color: "var(--warn)" }}>{drift.join(", ")}</span> : <span className="muted-cell">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showIngest && (
        <IngestModal
          projectId={projectId}
          onClose={() => setShowIngest(false)}
          onDone={async (n) => { setShowIngest(false); flash(`Imported ${n} endpoint${n === 1 ? "" : "s"}`); await load(projectId, driftOnly); }}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 200, background: "var(--panel)",
          border: "1px solid var(--accent)", color: "var(--accent)", padding: "9px 16px",
          borderRadius: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        }}>{toast}</div>
      )}
    </div>
  );
}

function IngestModal({ projectId, onClose, onDone }: {
  projectId: string; onClose: () => void; onDone: (n: number) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    let spec: unknown;
    try { spec = JSON.parse(text); }
    catch { setErr("Not valid JSON. Paste an OpenAPI 3.x / Swagger 2.0 document."); return; }
    setBusy(true);
    try {
      const res = await ingestOpenapi(projectId, spec);
      onDone(res.imported ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ingest failed");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: "min(640px, 100%)" }}>
        <div className="modal-header">
          <h2>Ingest OpenAPI spec</h2>
          <button onClick={onClose}><XIcon size={16} /></button>
        </div>
        <div className="modal-field">
          <label>OpenAPI 3.x or Swagger 2.0 (JSON)</label>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'{\n  "openapi": "3.0.0",\n  "paths": { ... }\n}'}
            rows={12}
            style={{
              background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)",
              padding: "8px 10px", borderRadius: 4, fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11, resize: "vertical", outline: "none",
            }}
          />
        </div>
        {err && <div style={{ color: "var(--bad)", fontSize: 12 }}>{err}</div>}
        <div className="modal-actions">
          <button className="action-btn" onClick={onClose}>Cancel</button>
          <button className="action-btn primary" onClick={submit} disabled={busy || !text.trim()}>
            {busy ? "Importing…" : "Import endpoints"}
          </button>
        </div>
      </div>
    </div>
  );
}
