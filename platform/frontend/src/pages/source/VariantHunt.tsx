import { useEffect, useRef, useState } from "react";
import { Layers, Zap, Filter } from "lucide-react";
import { fetchProjects, getApiKey } from "../../lib/api";

const SEV_COLOR: Record<string, string> = {
  critical: "var(--bad)", high: "var(--warn)", medium: "#fcd34d",
  low: "var(--good)", info: "var(--info)",
};

type Hyp = { id: string; title: string; severity: string; category: string; host: string; status: string; };

async function fetchHypotheses(pid: string): Promise<Hyp[]> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(pid)}/hypotheses`, {
    headers: { "X-Api-Key": getApiKey() },
  });
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? data as Hyp[] : [];
}

async function launchVariantScan(pid: string, hyp: Hyp): Promise<boolean> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(pid)}/raptor-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": getApiKey() },
    body: JSON.stringify({ protocol: "js", target_path: hyp.host || ".", output_format: "jsonl" }),
  });
  return r.ok;
}

export default function VariantHunt() {
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Hyp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [scanning, setScanning] = useState<Set<string>>(new Set());
  const [launched, setLaunched] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const [showBanner, setShowBanner] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjects().then(async (ps) => {
      if (cancelled || !ps.length) { setLoading(false); return; }
      const pid = ps[0].id;
      setProjectId(pid);
      const data = await fetchHypotheses(pid);
      if (!cancelled) {
        setRows(data.filter((h) => h.status === "confirmed" || h.status === "active"));
        setLoading(false);
      }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  }

  async function handleHunt(hyp: Hyp) {
    if (scanning.has(hyp.id) || launched.has(hyp.id)) return;
    setScanning((prev) => new Set(prev).add(hyp.id));
    const ok = await launchVariantScan(projectId, hyp);
    setScanning((prev) => { const n = new Set(prev); n.delete(hyp.id); return n; });
    if (ok) {
      setLaunched((prev) => new Set(prev).add(hyp.id));
      setShowBanner(true);
      showToast(`Variant scan launched for ${hyp.title}`);
    } else {
      showToast("Scan failed to launch — check Jobs page");
    }
  }

  const filtered = filter
    ? rows.filter((r) =>
        r.title.toLowerCase().includes(filter.toLowerCase()) ||
        (r.category ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        (r.host ?? "").toLowerCase().includes(filter.toLowerCase())
      )
    : rows;

  const stats = {
    total: rows.length,
    confirmed: rows.filter((r) => r.status === "confirmed").length,
    active: rows.filter((r) => r.status === "active").length,
  };

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Layers size={16} />
          <span>Variant Hunt</span>
          <small>{filtered.length} seeds</small>
        </div>
        <div className="toolbar-actions">
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input placeholder="Filter findings…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 1, borderBottom: "1px solid var(--border)", background: "var(--border)", flexShrink: 0 }}>
        {[
          { label: "Seeds", val: stats.total, color: "var(--accent)" },
          { label: "Confirmed", val: stats.confirmed, color: "var(--good)" },
          { label: "Active", val: stats.active, color: "var(--warn)" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ flex: 1, background: "var(--panel)", padding: "8px 16px" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>{val}</div>
          </div>
        ))}
      </div>

      {showBanner && (
        <div style={{ padding: "10px 16px", background: "var(--panel-2)", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--accent)", display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={12} />
          Scan launched — check the <strong style={{ cursor: "pointer", textDecoration: "underline" }}>Jobs</strong> page for live output.
          <button onClick={() => setShowBanner(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>×</button>
        </div>
      )}

      {loading
        ? <div className="page-loading">Loading variant seeds…</div>
        : filtered.length === 0
          ? (
            <div className="empty-state-block">
              <p>{rows.length === 0
                ? "No confirmed findings to hunt variants from — close some hypotheses first."
                : "No findings match current filter."}</p>
            </div>
          )
          : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Severity</th><th>Title</th><th>Category</th><th>Host</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((hyp) => {
                    const color = SEV_COLOR[hyp.severity?.toLowerCase()] ?? "var(--muted)";
                    const isScanning = scanning.has(hyp.id);
                    const isLaunched = launched.has(hyp.id);
                    return (
                      <tr key={hyp.id} className="data-row" style={{ borderLeft: `3px solid ${color}` }}>
                        <td><span className="sev-badge" style={{ color }}>{hyp.severity?.toUpperCase() ?? "—"}</span></td>
                        <td style={{ maxWidth: 280 }}>
                          <span style={{ fontSize: 12, color: "var(--text)" }}>{hyp.title}</span>
                        </td>
                        <td><span className="type-badge">{hyp.category || "—"}</span></td>
                        <td><code className="mono-cell" style={{ fontSize: 11 }}>{hyp.host || "—"}</code></td>
                        <td><span className="mono-cell">{hyp.status}</span></td>
                        <td>
                          <button
                            className="action-btn"
                            style={isLaunched ? { color: "var(--good)", borderColor: "var(--good)" } : {}}
                            disabled={isScanning || isLaunched}
                            onClick={() => handleHunt(hyp)}
                          >
                            {isScanning ? "Launching…" : isLaunched ? "✓ Launched" : <><Zap size={11} /> Hunt Variants</>}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
