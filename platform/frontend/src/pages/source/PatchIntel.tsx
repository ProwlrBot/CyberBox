import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Hypothesis = {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  evidence: unknown;
};

type CveEntry = {
  id: string;
  title: string;
  description: string;
  severity: string;
  cveId: string;
  tech: string;
  published: string;
  references: string[];
};

const SEV_COLOR: Record<string, string> = {
  critical: "var(--bad)",
  high: "var(--warn)",
  medium: "#fcd34d",
  low: "var(--good)",
  info: "var(--info)",
};

function parseCveFromHypothesis(h: Hypothesis): CveEntry {
  let ev: Record<string, unknown> = {};
  try {
    ev = typeof h.evidence === "string" ? JSON.parse(h.evidence) : (h.evidence as Record<string, unknown>) ?? {};
  } catch { /* ignore */ }

  const cveId = (ev.cve_id as string) ?? extractCveId(h.title) ?? h.id.slice(0, 12);
  return {
    id: h.id,
    title: h.title,
    description: h.description ?? "",
    severity: h.severity ?? "info",
    cveId,
    tech: (ev.tech as string) ?? (ev.technology as string) ?? "—",
    published: (ev.published as string) ?? (ev.published_at as string) ?? "",
    references: (ev.references as string[]) ?? [],
  };
}

function extractCveId(title: string): string | null {
  const m = title.match(/CVE-\d{4}-\d+/i);
  return m ? m[0].toUpperCase() : null;
}

export default function PatchIntel() {
  const [cves, setCves] = useState<CveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CveEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

    async function init() {
      try {
        const pResp = await fetch("/api/v1/projects", { headers });
        const projects = pResp.ok ? await pResp.json() : [];
        const projectId = projects[0]?.id ?? "";
        if (!projectId) { if (!cancelled) setLoading(false); return; }

        const hResp = await fetch(`/api/v1/projects/${projectId}/hypotheses`, { headers });
        const hypotheses: Hypothesis[] = hResp.ok ? await hResp.json() : [];

        if (!cancelled) {
          // Filter to CVE-sweep sourced hypotheses
          const cveSweepHypos = hypotheses.filter((h) => {
            try {
              const ev = typeof h.evidence === "string"
                ? JSON.parse(h.evidence)
                : h.evidence ?? {};
              return (ev as Record<string, unknown>).source === "cve_sweep";
            } catch { return false; }
          });

          // Also include hypotheses that have CVE IDs in title even without source tag
          const withCveId = hypotheses.filter(
            (h) => extractCveId(h.title) !== null && !cveSweepHypos.find((c) => c.id === h.id)
          );

          const all = [...cveSweepHypos, ...withCveId];
          setCves(all.map(parseCveFromHypothesis));
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Activity size={16} />
          <span>Patch Intel</span>
          <small>{cves.length} entries</small>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : cves.length === 0 ? (
        <div className="empty-state-block">
          <p>Run a CVE sweep first to populate patch intel.</p>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Left panel — CVE list (60%) */}
          <div
            style={{
              width: "60%",
              borderRight: "1px solid var(--border)",
              overflow: "auto",
            }}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th>CVE ID</th>
                  <th>Severity</th>
                  <th>Tech</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {cves.map((c) => (
                  <tr
                    key={c.id}
                    className="data-row"
                    style={{
                      cursor: "pointer",
                      background: selected?.id === c.id ? "var(--panel-2)" : undefined,
                      borderLeft: selected?.id === c.id
                        ? "3px solid var(--accent)"
                        : "3px solid transparent",
                    }}
                    onClick={() => setSelected(selected?.id === c.id ? null : c)}
                  >
                    <td>
                      <code className="mono-cell" style={{ color: "var(--info)" }}>
                        {c.cveId}
                      </code>
                    </td>
                    <td>
                      <span
                        className="sev-badge"
                        style={{ color: SEV_COLOR[c.severity] ?? "var(--muted)" }}
                      >
                        {c.severity}
                      </span>
                    </td>
                    <td className="muted-cell">{c.tech}</td>
                    <td className="time-cell">
                      {c.published ? new Date(c.published).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Right panel — selected CVE details (40%) */}
          <div style={{ width: "40%", overflow: "auto", padding: "16px 20px" }}>
            {!selected ? (
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  paddingTop: 24,
                }}
              >
                Select a CVE to view details.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <code style={{ fontSize: 13, color: "var(--info)", fontFamily: "'JetBrains Mono', monospace" }}>
                    {selected.cveId}
                  </code>
                  <span
                    className="sev-badge"
                    style={{
                      color: SEV_COLOR[selected.severity] ?? "var(--muted)",
                      marginLeft: 10,
                    }}
                  >
                    {selected.severity}
                  </span>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      marginBottom: 4,
                    }}
                  >
                    Title
                  </div>
                  <strong style={{ fontSize: 13 }}>{selected.title}</strong>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      marginBottom: 4,
                    }}
                  >
                    Description
                  </div>
                  <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
                    {selected.description || "No description available."}
                  </p>
                </div>

                {selected.references.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        marginBottom: 6,
                      }}
                    >
                      References
                    </div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                      {selected.references.map((ref, i) => (
                        <li key={i}>
                          <a
                            href={ref}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: 11,
                              color: "var(--info)",
                              fontFamily: "'JetBrains Mono', monospace",
                              wordBreak: "break-all",
                            }}
                          >
                            {ref}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ marginTop: 8 }}>
                  <button
                    className="action-btn primary"
                    style={{ opacity: 0.7, cursor: "default" }}
                    title="Coming soon"
                    onClick={() => {/* placeholder */}}
                  >
                    Start variant hunt
                  </button>
                  <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 10 }}>
                    (coming soon)
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
