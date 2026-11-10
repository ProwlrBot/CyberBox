import { useEffect, useRef, useState } from "react";
import { Filter, ShieldAlert, Zap, X as XIcon } from "lucide-react";
import { fetchProjects, getApiKey } from "../../lib/api";

const SEV_COLOR: Record<string, string> = {
  critical: "var(--bad)",
  high: "var(--warn)",
  medium: "#fcd34d",
  low: "var(--good)",
  unknown: "var(--muted)",
};

type CveEvidence = {
  source: string;
  cve_id: string;
  tech: string;
  cvss_score: number | null;
  vector: string | null;
  published: string;
  references: string[];
};

type CveRow = {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  evidence: CveEvidence | null;
};

async function fetchCveRows(projectId: string): Promise<CveRow[]> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/cve-sweep`, {
    headers: { "X-Api-Key": getApiKey() },
  });
  if (!r.ok) return [];
  const rows = await r.json() as Array<Record<string, unknown>>;
  return rows.map((h) => {
    let evidence: CveEvidence | null = null;
    try { evidence = JSON.parse(h.evidence as string) as CveEvidence; } catch { /* ignore */ }
    return {
      id: h.id as string,
      title: h.title as string,
      description: h.description as string,
      severity: h.severity as string,
      status: h.status as string,
      evidence,
    };
  });
}

async function runSweep(
  projectId: string,
  techs: string[],
  cvssMin: number,
  daysBack: number,
  nvdKey: string,
): Promise<{ inserted: number }> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/cve-sweep`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": getApiKey() },
    body: JSON.stringify({ techs, cvss_min: cvssMin, days_back: daysBack, nvd_api_key: nvdKey || undefined }),
  });
  return r.ok ? r.json() : { inserted: 0 };
}

async function queueHunt(projectId: string, hyp_id: string): Promise<void> {
  await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/hypotheses/${hyp_id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Api-Key": getApiKey() },
    body: JSON.stringify({ status: "active" }),
  });
}

export default function CveIntel() {
  const [projectId, setProjectId] = useState<string>("");
  const [rows, setRows] = useState<CveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [sevFilter, setSevFilter] = useState<Set<string>>(new Set(["critical", "high"]));
  const [sweepOpen, setSweepOpen] = useState(false);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [techInput, setTechInput] = useState("");
  const [cvssMin, setCvssMin] = useState("7.0");
  const [daysBack, setDaysBack] = useState("90");
  const [nvdKey, setNvdKey] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchProjects().then(async (ps) => {
      if (!ps.length) { setLoading(false); return; }
      const pid = ps[0].id;
      setProjectId(pid);
      const data = await fetchCveRows(pid);
      setRows(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  }

  function toggleSev(s: string) {
    setSevFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  const filtered = rows.filter((r) => {
    if (!sevFilter.has(r.severity.toLowerCase())) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return (
        r.title.toLowerCase().includes(q) ||
        (r.evidence?.tech ?? "").toLowerCase().includes(q) ||
        (r.evidence?.cve_id ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleSweep() {
    const techs = techInput.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean);
    if (!techs.length) { showToast("Enter at least one technology"); return; }
    setSweepRunning(true);
    const result = await runSweep(projectId, techs, parseFloat(cvssMin) || 7.0, parseInt(daysBack) || 90, nvdKey);
    const data = await fetchCveRows(projectId);
    setRows(data);
    setSweepRunning(false);
    setSweepOpen(false);
    showToast(`Sweep complete — ${result.inserted} new CVEs`);
  }

  async function handleHunt(row: CveRow) {
    if (queued.current.has(row.id)) return;
    queued.current.add(row.id);
    await queueHunt(projectId, row.id);
    setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: "active" } : r));
    showToast(`${row.evidence?.cve_id ?? row.id} queued for hunt`);
  }

  const stats = {
    critical: rows.filter((r) => r.severity === "critical").length,
    high: rows.filter((r) => r.severity === "high").length,
    medium: rows.filter((r) => r.severity === "medium").length,
    total: rows.length,
  };

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <ShieldAlert size={16} />
          <span>CVE Intel</span>
          <small>{filtered.length} of {rows.length}</small>
        </div>
        <div className="toolbar-actions">
          {(["critical", "high", "medium", "low"] as const).map((s) => (
            <button
              key={s}
              className="action-btn"
              style={sevFilter.has(s) ? { color: SEV_COLOR[s], borderColor: SEV_COLOR[s], background: "var(--panel-2)" } : {}}
              onClick={() => toggleSev(s)}
            >
              {s.toUpperCase()}
            </button>
          ))}
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input placeholder="Filter CVEs…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {projectId && (
            <button className="action-btn primary" onClick={() => setSweepOpen(true)}>
              <Zap size={13} /> Sweep
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 1, borderBottom: "1px solid var(--border)", background: "var(--border)", flexShrink: 0 }}>
        {[
          { label: "Critical", val: stats.critical, color: "var(--bad)" },
          { label: "High",     val: stats.high,     color: "var(--warn)" },
          { label: "Medium",   val: stats.medium,   color: "#fcd34d" },
          { label: "Total",    val: stats.total,    color: "var(--muted)" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ flex: 1, background: "var(--panel)", padding: "8px 16px" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>{val}</div>
          </div>
        ))}
      </div>

      {loading
        ? <div className="page-loading">Loading CVE intel…</div>
        : filtered.length === 0
          ? (
            <div className="empty-state-block">
              <p>{rows.length === 0 ? "No CVE data yet — run a sweep to pull HIGH/CRITICAL CVEs for your tech stack." : "No CVEs match current filter."}</p>
            </div>
          )
          : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Severity</th><th>CVE</th><th>Tech</th><th>CVSS</th>
                    <th>Description</th><th>Published</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const ev = row.evidence;
                    const sev = row.severity.toLowerCase();
                    const color = SEV_COLOR[sev] ?? "var(--muted)";
                    const score = ev?.cvss_score;
                    return (
                      <tr key={row.id} className="data-row" style={{ borderLeft: `3px solid ${color}` }}>
                        <td><span className="sev-badge" style={{ color }}>{row.severity.toUpperCase()}</span></td>
                        <td><code className="mono-cell">{ev?.cve_id ?? "—"}</code></td>
                        <td><span className="type-badge">{ev?.tech ?? "—"}</span></td>
                        <td>
                          {score != null && (
                            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ width: 48, height: 4, background: "var(--panel-2)", borderRadius: 2, overflow: "hidden", display: "inline-block" }}>
                                <span style={{ display: "block", height: "100%", width: `${score * 10}%`, background: color, borderRadius: 2 }} />
                              </span>
                              <code className="mono-cell">{score.toFixed(1)}</code>
                            </span>
                          )}
                        </td>
                        <td style={{ maxWidth: 320 }}>
                          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 11, lineHeight: 1.5, color: "var(--muted)" }}>
                            {row.description}
                          </span>
                        </td>
                        <td className="time-cell">{ev?.published ? ev.published.slice(0, 10) : "—"}</td>
                        <td>
                          <span className="mono-cell">{row.status}</span>
                        </td>
                        <td>
                          <button
                            className="action-btn"
                            style={row.status === "active" ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}}
                            disabled={row.status === "active"}
                            onClick={() => handleHunt(row)}
                          >
                            {row.status === "active" ? "✓ Queued" : "Hunt"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

      {sweepOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setSweepOpen(false); }}>
          <div className="modal" style={{ width: "min(480px, 100%)" }}>
            <div>
              <Zap size={16} style={{ color: "var(--accent)" }} />
              <h2>CVE Sweep</h2>
              <button onClick={() => setSweepOpen(false)}><XIcon size={16} /></button>
            </div>
            <p style={{ margin: "10px 0 16px" }}>Pull HIGH/CRITICAL CVEs from NVD for your tech stack and load them as hypotheses.</p>

            <label style={{ display: "grid", gap: 7, color: "var(--muted)", fontSize: 11, marginBottom: 10 }}>
              Tech stack (one per line or comma-separated)
              <textarea
                value={techInput}
                onChange={(e) => setTechInput(e.target.value)}
                placeholder={"wordpress\nnginx\nphp\noauth2"}
                rows={4}
                style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "8px 10px", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, resize: "vertical", outline: "none" }}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <label style={{ display: "grid", gap: 7, color: "var(--muted)", fontSize: 11 }}>
                Min CVSS
                <input value={cvssMin} onChange={(e) => setCvssMin(e.target.value)}
                  style={{ height: 34, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "0 10px", borderRadius: 3, fontFamily: "inherit", fontSize: 11, outline: "none" }} />
              </label>
              <label style={{ display: "grid", gap: 7, color: "var(--muted)", fontSize: 11 }}>
                Days back
                <input value={daysBack} onChange={(e) => setDaysBack(e.target.value)}
                  style={{ height: 34, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "0 10px", borderRadius: 3, fontFamily: "inherit", fontSize: 11, outline: "none" }} />
              </label>
            </div>

            <label style={{ display: "grid", gap: 7, color: "var(--muted)", fontSize: 11, marginBottom: 14 }}>
              NVD API key (optional — higher rate limit)
              <input value={nvdKey} onChange={(e) => setNvdKey(e.target.value)} type="password" placeholder="optional"
                style={{ height: 34, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "0 10px", borderRadius: 3, fontFamily: "inherit", fontSize: 11, outline: "none" }} />
            </label>

            <button className="action-btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={sweepRunning} onClick={handleSweep}>
              {sweepRunning ? "Sweeping NVD…" : "Run sweep"}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 200,
          background: "var(--panel)", border: "1px solid var(--accent)",
          color: "var(--accent)", padding: "9px 16px", borderRadius: 5,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
