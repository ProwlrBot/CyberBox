import { useEffect, useMemo, useState } from "react";
import {
  Table2, RefreshCw, Download, Columns3, ArrowUp, ArrowDown, Lock, ShieldAlert,
} from "lucide-react";
import { fetchProjects, fetchInspectorEndpoints, type InspectorEndpoint } from "../../lib/api";

// Dense, RedAmon-Node-Inspector-style grid over the endpoint inventory: sortable columns,
// per-column filtering, column show/hide, CSV/JSON/MD export of the filtered set.

const METHOD_COLOR: Record<string, string> = {
  GET: "var(--good)", POST: "var(--accent)", PUT: "var(--warn)",
  PATCH: "var(--warn)", DELETE: "var(--bad)", HEAD: "var(--muted)", OPTIONS: "var(--muted)",
};

function jarr(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map((x) => typeof x === "string" ? x : (x?.name ?? JSON.stringify(x))) : []; }
  catch { return []; }
}

type Col = {
  key: string;
  label: string;
  // value used for filtering/sorting/export (plain string)
  val: (e: InspectorEndpoint) => string;
  // optional custom cell renderer
  cell?: (e: InspectorEndpoint) => React.ReactNode;
  width?: number;
  defaultOn?: boolean;
};

const COLS: Col[] = [
  { key: "method", label: "METHOD", width: 70, defaultOn: true,
    val: (e) => e.method,
    cell: (e) => <span style={{ color: METHOD_COLOR[e.method] ?? "var(--text)", fontWeight: 700 }}>{e.method}</span> },
  { key: "host", label: "HOST", width: 190, defaultOn: true, val: (e) => e.host },
  { key: "path", label: "PATH", width: 320, defaultOn: true, val: (e) => e.path,
    cell: (e) => <span style={{ color: "var(--text)" }}>{e.path}</span> },
  { key: "path_template", label: "TEMPLATE", width: 240, defaultOn: false, val: (e) => e.path_template ?? "" },
  { key: "source", label: "SOURCE", width: 80, defaultOn: true, val: (e) => e.source,
    cell: (e) => <span style={{ color: "var(--info)" }}>{e.source}</span> },
  { key: "auth", label: "AUTH", width: 90, defaultOn: true,
    val: (e) => (e.auth_required ? (jarr(e.auth_schemes).join(",") || "yes") : "no"),
    cell: (e) => e.auth_required
      ? <span style={{ color: "var(--warn)", display: "inline-flex", alignItems: "center", gap: 3 }}><Lock size={10} />{jarr(e.auth_schemes).join(",") || "yes"}</span>
      : <span style={{ color: "var(--muted)" }}>—</span> },
  { key: "content_types", label: "CONTENT-TYPE", width: 160, defaultOn: false, val: (e) => jarr(e.content_types).join(" ") },
  { key: "status_codes", label: "STATUS", width: 110, defaultOn: true, val: (e) => jarr(e.status_codes).join(" ") },
  { key: "params", label: "PARAMS", width: 70, defaultOn: true,
    val: (e) => String(jarr(e.params).length),
    cell: (e) => { const n = jarr(e.params).length; return <span style={{ color: n ? "var(--accent)" : "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>{n}</span>; } },
  { key: "tags", label: "TAGS", width: 140, defaultOn: false, val: (e) => jarr(e.tags).join(" ") },
  { key: "drift", label: "DRIFT", width: 80, defaultOn: true,
    val: (e) => String(jarr(e.drift_flags).length),
    cell: (e) => { const n = jarr(e.drift_flags).length; return n
      ? <span style={{ color: "var(--bad)", display: "inline-flex", alignItems: "center", gap: 3 }}><ShieldAlert size={10} />{n}</span>
      : <span style={{ color: "var(--muted)" }}>—</span>; } },
  { key: "first_seen_at", label: "FIRST SEEN", width: 150, defaultOn: false, val: (e) => e.first_seen_at },
  { key: "last_seen_at", label: "LAST SEEN", width: 150, defaultOn: false, val: (e) => e.last_seen_at },
];

const chip: React.CSSProperties = {
  fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted)",
};

export default function NodeInspector() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<InspectorEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState("host");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [visible, setVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(COLS.map((c) => [c.key, !!c.defaultOn])));
  const [showCols, setShowCols] = useState(false);

  async function load(pid: string) {
    if (!pid) return;
    setLoading(true);
    setRows(await fetchInspectorEndpoints(pid));
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const ps = await fetchProjects();
      setProjects(ps);
      const pid = ps[0]?.id ?? "";
      setProjectId(pid);
      await load(pid);
    })();
  }, []);

  const shownCols = COLS.filter((c) => visible[c.key]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((e) => {
      if (needle && !shownCols.some((c) => c.val(e).toLowerCase().includes(needle))) return false;
      for (const [k, f] of Object.entries(colFilters)) {
        if (!f) continue;
        const col = COLS.find((c) => c.key === k);
        if (col && !col.val(e).toLowerCase().includes(f.toLowerCase())) return false;
      }
      return true;
    });
    const col = COLS.find((c) => c.key === sortKey);
    if (col) {
      out = [...out].sort((a, b) => {
        const av = col.val(a), bv = col.val(b);
        const an = Number(av), bn = Number(bv);
        const cmp = (!isNaN(an) && !isNaN(bn) && av !== "" && bv !== "")
          ? an - bn : av.localeCompare(bv);
        return cmp * sortDir;
      });
    }
    return out;
  }, [rows, q, colFilters, sortKey, sortDir, shownCols]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  }

  function download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  function exportCsv() {
    const head = shownCols.map((c) => c.label).join(",");
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const body = filtered.map((e) => shownCols.map((c) => esc(c.val(e))).join(",")).join("\n");
    download("endpoints.csv", `${head}\n${body}`, "text/csv");
  }
  function exportJson() {
    download("endpoints.json", JSON.stringify(filtered, null, 2), "application/json");
  }
  function exportMd() {
    const head = `| ${shownCols.map((c) => c.label).join(" | ")} |`;
    const sep = `| ${shownCols.map(() => "---").join(" | ")} |`;
    const body = filtered.map((e) => `| ${shownCols.map((c) => c.val(e).replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
    download("endpoints.md", `${head}\n${sep}\n${body}\n`, "text/markdown");
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Table2 size={16} />
          <span>Node Inspector</span>
          <small>{filtered.length} / {rows.length} endpoints</small>
        </div>
        <div className="toolbar-actions">
          {projects.length > 1 && (
            <select className="action-btn" value={projectId}
                    onChange={(e) => { setProjectId(e.target.value); load(e.target.value); }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="filter-input-wrap">
            <input placeholder="Search endpoints…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div style={{ position: "relative" }}>
            <button className="action-btn" onClick={() => setShowCols((v) => !v)} title="Columns">
              <Columns3 size={13} /> {shownCols.length}/{COLS.length}
            </button>
            {showCols && (
              <div style={{ position: "absolute", right: 0, top: "110%", zIndex: 20, background: "var(--panel)",
                            border: "1px solid var(--border)", borderRadius: 6, padding: 8, minWidth: 180,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                {COLS.map((c) => (
                  <label key={c.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 4px", fontSize: 11, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!visible[c.key]}
                           onChange={() => setVisible((v) => ({ ...v, [c.key]: !v[c.key] }))} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="action-btn" onClick={exportCsv} title="Export CSV"><Download size={13} /> CSV</button>
          <button className="action-btn" onClick={exportJson} title="Export JSON"><Download size={13} /> JSON</button>
          <button className="action-btn" onClick={exportMd} title="Export Markdown"><Download size={13} /> MD</button>
          <button className="action-btn" onClick={() => load(projectId)} title="Refresh"><RefreshCw size={13} /></button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading endpoints…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state-block">
          <p>No endpoints yet. Ingest a HAR / OpenAPI / Burp / Caido export in API Genome, or run recon, to populate the inventory.</p>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5,
                          fontFamily: "'JetBrains Mono', monospace" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 5 }}>
              <tr style={{ background: "var(--panel)" }}>
                {shownCols.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                      style={{ textAlign: "left", padding: "7px 10px", cursor: "pointer", whiteSpace: "nowrap",
                               borderBottom: "1px solid var(--border)", color: sortKey === c.key ? "var(--accent)" : "var(--muted)",
                               ...chip, minWidth: c.width }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      {c.label}
                      {sortKey === c.key && (sortDir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                    </span>
                  </th>
                ))}
              </tr>
              <tr style={{ background: "var(--bg)" }}>
                {shownCols.map((c) => (
                  <th key={c.key} style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>
                    <input
                      value={colFilters[c.key] ?? ""}
                      onChange={(e) => setColFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                      placeholder="filter"
                      style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)",
                               borderRadius: 4, padding: "3px 6px", color: "var(--text)", fontSize: 10,
                               fontFamily: "'JetBrains Mono', monospace" }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} style={{ borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--panel)")}
                    onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}>
                  {shownCols.map((c) => (
                    <td key={c.key} style={{ padding: "6px 10px", whiteSpace: "nowrap", color: "var(--muted)",
                                             maxWidth: c.width, overflow: "hidden", textOverflow: "ellipsis" }}
                        title={c.val(e)}>
                      {c.cell ? c.cell(e) : (c.val(e) || <span style={{ color: "var(--muted)" }}>—</span>)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty-state-block"><p>No endpoints match the filters.</p></div>
          )}
        </div>
      )}
    </div>
  );
}
