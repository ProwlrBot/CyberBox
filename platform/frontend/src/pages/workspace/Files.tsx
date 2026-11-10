import { useEffect, useState } from "react";
import { FolderOpen, Download, Filter, Eye, X as XIcon } from "lucide-react";
import { fetchProjects, getApiKey } from "../../lib/api";

type EvidenceFile = { id: string; label: string; path: string; kind: string; created_at: string; size_bytes: number | null; };
type Report = { id: string; title: string; format: string; created_at: string; };

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toISOString().slice(0, 16).replace("T", " "); }
  catch { return iso; }
}

export default function Files() {
  const [projectId, setProjectId] = useState("");
  const [evidence, setEvidence] = useState<EvidenceFile[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"evidence" | "reports">("evidence");
  const [filter, setFilter] = useState("");
  const [modalContent, setModalContent] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjects().then(async (ps) => {
      if (cancelled || !ps.length) { setLoading(false); return; }
      const pid = ps[0].id;
      setProjectId(pid);
      const headers = { "X-Api-Key": getApiKey() };
      const [er, rr] = await Promise.allSettled([
        fetch(`/api/v1/projects/${encodeURIComponent(pid)}/evidence`, { headers }).then((r) => r.json()),
        fetch(`/api/v1/projects/${encodeURIComponent(pid)}/reports`, { headers }).then((r) => r.json()),
      ]);
      if (!cancelled) {
        setEvidence(er.status === "fulfilled" && Array.isArray(er.value) ? er.value : []);
        setReports(rr.status === "fulfilled" && Array.isArray(rr.value) ? rr.value : []);
        setLoading(false);
      }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function viewReport(report: Report) {
    try {
      const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(report.id)}`, {
        headers: { "X-Api-Key": getApiKey() },
      });
      if (r.ok) {
        const data = await r.json();
        setModalContent({ title: report.title, body: data.content ?? data.body ?? JSON.stringify(data, null, 2) });
      }
    } catch { /* ignore */ }
  }

  const filteredEvidence = filter
    ? evidence.filter((e) =>
        (e.label ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        (e.path ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        (e.kind ?? "").toLowerCase().includes(filter.toLowerCase())
      )
    : evidence;

  const filteredReports = filter
    ? reports.filter((r) => r.title.toLowerCase().includes(filter.toLowerCase()))
    : reports;

  const tabStyle = (tab: "evidence" | "reports") => ({
    padding: "10px 16px",
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    cursor: "pointer",
    background: "none",
    border: "none",
    borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
    color: activeTab === tab ? "var(--text)" : "var(--muted)",
  } as React.CSSProperties);

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <FolderOpen size={16} />
          <span>Files</span>
        </div>
        <div className="toolbar-actions">
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0 }}>
        <button style={tabStyle("evidence")} onClick={() => setActiveTab("evidence")}>Evidence ({evidence.length})</button>
        <button style={tabStyle("reports")} onClick={() => setActiveTab("reports")}>Reports ({reports.length})</button>
      </div>

      {loading ? (
        <div className="page-loading">Loading files…</div>
      ) : activeTab === "evidence" ? (
        filteredEvidence.length === 0 ? (
          <div className="empty-state-block"><p>No evidence files yet — run a scan to capture artifacts.</p></div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Kind</th><th>Label</th><th>Path</th><th>Size</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {filteredEvidence.map((ev) => (
                  <tr key={ev.id} className="data-row">
                    <td><span className="type-badge">{ev.kind || "—"}</span></td>
                    <td style={{ fontSize: 12 }}>{ev.label || "—"}</td>
                    <td><code className="mono-cell" style={{ fontSize: 10 }}>{ev.path || "—"}</code></td>
                    <td className="muted-cell">{formatSize(ev.size_bytes)}</td>
                    <td className="time-cell">{fmtDate(ev.created_at)}</td>
                    <td>
                      <a
                        href={`/api/v1/projects/${encodeURIComponent(projectId)}/evidence/${encodeURIComponent(ev.id)}/download`}
                        download
                        style={{ textDecoration: "none" }}
                      >
                        <button className="action-btn"><Download size={12} /> Download</button>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        filteredReports.length === 0 ? (
          <div className="empty-state-block"><p>No reports yet — generate a report from the Reports page.</p></div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Title</th><th>Format</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {filteredReports.map((rep) => (
                  <tr key={rep.id} className="data-row">
                    <td style={{ fontSize: 12 }}>{rep.title}</td>
                    <td><span className="type-badge">{rep.format || "—"}</span></td>
                    <td className="time-cell">{fmtDate(rep.created_at)}</td>
                    <td>
                      <button className="action-btn" onClick={() => viewReport(rep)}>
                        <Eye size={12} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {modalContent && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setModalContent(null); }}>
          <div className="modal" style={{ width: "min(760px, 95vw)", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 14 }}>{modalContent.title}</h2>
              <button onClick={() => setModalContent(null)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>
                <XIcon size={16} />
              </button>
            </div>
            <pre style={{
              overflowY: "auto", whiteSpace: "pre-wrap", fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11, color: "var(--text)", background: "var(--bg)", padding: 16,
              borderRadius: 4, border: "1px solid var(--border)", margin: 0, flex: 1,
            }}>
              {modalContent.body}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
