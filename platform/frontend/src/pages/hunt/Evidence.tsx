import { useEffect, useState } from "react";
import { Archive } from "lucide-react";
import { getApiKey } from "../../lib/api";

const SEV_COLOR: Record<string, string> = {
  critical: "var(--bad)", high: "var(--warn)", medium: "#fcd34d",
  low: "var(--good)", info: "var(--info)",
};

type Hypothesis = {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  evidence: string | null;
  updated_at?: string;
};

type ParsedEvidence = { source?: string; [key: string]: unknown };

function parseEvidence(raw: string | null): ParsedEvidence | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function Evidence() {
  const [rows, setRows] = useState<Hypothesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const key = getApiKey();
      const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
      try {
        const projectsRes = await fetch("/api/v1/projects", { headers });
        const projects = projectsRes.ok ? await projectsRes.json() : [];
        const pid = projects[0]?.id ?? "";
        if (!pid || cancelled) { setLoading(false); return; }
        const r = await fetch(`/api/v1/projects/${pid}/hypotheses`, { headers });
        const data = r.ok ? await r.json() : [];
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Archive size={16} />
          <span>Evidence</span>
          <small>{rows.length}</small>
        </div>
      </div>

      {loading
        ? <div className="page-loading">Loading…</div>
        : rows.length === 0
          ? (
            <div className="empty-state-block">
              <p>No evidence yet — run a scan or CVE sweep to generate hypotheses</p>
            </div>
          )
          : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Evidence source</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => {
                    const ev = parseEvidence(h.evidence);
                    const isOpen = expanded.has(h.id);
                    return (
                      <>
                        <tr
                          key={h.id}
                          className="data-row"
                          style={{ cursor: "pointer" }}
                          onClick={() => toggleRow(h.id)}
                        >
                          <td>
                            <span style={{ color: isOpen ? "var(--accent)" : "var(--text)" }}>
                              {h.title}
                            </span>
                          </td>
                          <td>
                            <span
                              className="sev-badge"
                              style={{ color: SEV_COLOR[h.severity?.toLowerCase()] ?? "var(--muted)" }}
                            >
                              {h.severity ?? "—"}
                            </span>
                          </td>
                          <td>
                            <code className="type-badge">{h.status ?? "—"}</code>
                          </td>
                          <td>
                            {ev?.source
                              ? <code className="type-badge">{ev.source}</code>
                              : <span className="muted-cell">—</span>}
                          </td>
                          <td className="time-cell">
                            {h.updated_at ? new Date(h.updated_at).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${h.id}-expand`} style={{ background: "var(--panel-2)" }}>
                            <td colSpan={5} style={{ padding: "12px 16px" }}>
                              {h.description && (
                                <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
                                  {h.description}
                                </p>
                              )}
                              {h.evidence && (
                                <pre style={{
                                  margin: 0, padding: "10px 12px",
                                  background: "var(--bg)", border: "1px solid var(--border)",
                                  borderRadius: 4, fontSize: 11, color: "var(--muted)",
                                  fontFamily: "JetBrains Mono, monospace",
                                  overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
                                }}>
                                  {JSON.stringify(ev ?? h.evidence, null, 2)}
                                </pre>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}
