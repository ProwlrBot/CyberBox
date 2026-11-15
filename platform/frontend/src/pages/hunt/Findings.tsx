import { useEffect, useState } from "react";
import { Filter, Flag, X, ChevronRight, Copy, ExternalLink,
         AlertTriangle, Shield, GitBranch, Wrench } from "lucide-react";
import { fetchProjects, fetchFindings } from "../../lib/api";

const SEV_COLOR: Record<string, string> = {
  critical: "var(--bad)", high: "var(--warn)", medium: "#fcd34d",
  low: "var(--good)", info: "var(--info)",
};

type Finding = {
  id: string; name: string; severity: string; category: string;
  cve: string | null; host: string; path?: string; status: string;
  verified: boolean; detected_at: string; description?: string;
  request?: string; response?: string; payload?: string;
  reproduction_steps?: string; remediation?: string;
  cwe?: string; references?: string[]; agent_id?: string;
  dedup_key?: string;
};

type Tab = "attack" | "proof" | "trace" | "remediation";

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: copied ? "var(--good)" : "var(--muted)", padding: "2px 4px",
      }}
      title="Copy"
    >
      {copied ? "✓" : <Copy size={11} />}
    </button>
  );
}

function CodeBlock({ label, content }: { label: string; content?: string }) {
  if (!content) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 8px", background: "var(--panel-2)",
        border: "1px solid var(--border)", borderRadius: "4px 4px 0 0",
      }}>
        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "JetBrains Mono, monospace" }}>{label}</span>
        <CopyBtn text={content} />
      </div>
      <pre style={{
        margin: 0, padding: "8px 10px", fontSize: 11,
        fontFamily: "JetBrains Mono, monospace", overflowX: "auto",
        background: "var(--panel)", border: "1px solid var(--border)",
        borderTop: "none", borderRadius: "0 0 4px 4px",
        color: "var(--text)", maxHeight: 300, overflowY: "auto",
        whiteSpace: "pre-wrap", wordBreak: "break-all",
      }}>{content}</pre>
    </div>
  );
}

function FindingPanel({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("attack");

  const tabs: { id: Tab; label: string; Icon: React.ElementType }[] = [
    { id: "attack", label: "Attack Path", Icon: AlertTriangle },
    { id: "proof", label: "Proof", Icon: Shield },
    { id: "trace", label: "Agent Trace", Icon: GitBranch },
    { id: "remediation", label: "Remediation", Icon: Wrench },
  ];

  const curlCmd = finding.request
    ? `# Reproduce:\ncurl -v '${finding.host}${finding.path ?? ""}' \\\n  -X POST \\\n  --data '${finding.payload ?? ""}'\n# From raw request:\n${finding.request}`
    : null;

  return (
    <div style={{
      width: 540, flexShrink: 0, borderLeft: "1px solid var(--border)",
      display: "flex", flexDirection: "column", overflow: "hidden",
      background: "var(--panel-2)",
    }}>
      {/* Panel header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 14px", borderBottom: "1px solid var(--border)",
      }}>
        <span style={{
          display: "inline-block", width: 8, height: 8, borderRadius: 2,
          background: SEV_COLOR[finding.severity] ?? "var(--muted)", flexShrink: 0,
        }} />
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {finding.name}
        </span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}>
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", borderBottom: "1px solid var(--border)",
        background: "var(--panel)",
      }}>
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              gap: 5, padding: "7px 4px", fontSize: 11, cursor: "pointer",
              border: "none", borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent",
              background: "transparent", color: tab === id ? "var(--accent)" : "var(--muted)",
            }}
          >
            <Icon size={11} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>

        {/* ── Attack Path ── */}
        {tab === "attack" && (
          <div>
            <div style={{
              display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px",
              fontSize: 12, marginBottom: 16,
            }}>
              {((): [string, React.ReactNode][] => {
                const rows: [string, React.ReactNode][] = [
                  ["Severity", <span style={{ color: SEV_COLOR[finding.severity], fontWeight: 700 }}>{finding.severity.toUpperCase()}</span>],
                  ["Category", finding.category],
                  ["Host", <code style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{finding.host}</code>],
                  ["Status", finding.status],
                  ["Verified", finding.verified ? <span style={{ color: "var(--good)" }}>✓ Verified</span> : <span style={{ color: "var(--muted)" }}>Unverified</span>],
                  ["Detected", new Date(finding.detected_at).toLocaleString()],
                ];
                if (finding.path) rows.splice(2, 0, ["Path", <code style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{finding.path}</code>]);
                if (finding.cve) rows.splice(-2, 0, ["CVE", <a href={`https://nvd.nist.gov/vuln/detail/${finding.cve}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>{finding.cve} <ExternalLink size={9} /></a>]);
                if (finding.cwe) rows.splice(-2, 0, ["CWE", <span style={{ color: "var(--warn)", fontFamily: "JetBrains Mono, monospace" }}>{finding.cwe}</span>]);
                return rows;
              })().map(([label, val], i) => (
                <>
                  <span key={`l${i}`} style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{label}</span>
                  <span key={`v${i}`}>{val}</span>
                </>
              ))}
            </div>

            {finding.description && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>DESCRIPTION</div>
                <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>{finding.description}</p>
              </div>
            )}

            {finding.reproduction_steps && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>REPRODUCTION STEPS</div>
                <pre style={{
                  fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                  background: "var(--panel)", border: "1px solid var(--border)",
                  borderRadius: 4, padding: "8px 10px", whiteSpace: "pre-wrap",
                  wordBreak: "break-all", margin: 0,
                }}>{finding.reproduction_steps}</pre>
              </div>
            )}
          </div>
        )}

        {/* ── Proof ── */}
        {tab === "proof" && (
          <div>
            {finding.payload && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>PAYLOAD</div>
                <div style={{ position: "relative" }}>
                  <code style={{
                    display: "block", padding: "6px 10px",
                    background: "var(--panel)", border: "1px solid var(--accent)",
                    borderRadius: 4, fontSize: 11,
                    fontFamily: "JetBrains Mono, monospace",
                    color: "var(--accent)", wordBreak: "break-all",
                  }}>{finding.payload}</code>
                  <div style={{ position: "absolute", top: 4, right: 6 }}>
                    <CopyBtn text={finding.payload} />
                  </div>
                </div>
              </div>
            )}
            <CodeBlock label="REQUEST" content={finding.request} />
            <CodeBlock label="RESPONSE" content={finding.response} />
            {curlCmd && <CodeBlock label="REPRODUCE (curl)" content={curlCmd} />}
            {!finding.request && !finding.payload && (
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                No request/response data captured. Attach evidence from the Evidence tab.
              </div>
            )}
          </div>
        )}

        {/* ── Agent Trace ── */}
        {tab === "trace" && (
          <div>
            {finding.agent_id ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>DISCOVERED BY</div>
                <code style={{
                  display: "inline-block", padding: "4px 8px",
                  background: "var(--panel)", border: "1px solid var(--border)",
                  borderRadius: 4, fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                }}>{finding.agent_id}</code>
              </div>
            ) : null}
            {finding.dedup_key && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>DEDUP KEY</div>
                <code style={{
                  display: "block", padding: "4px 8px",
                  background: "var(--panel)", border: "1px solid var(--border)",
                  borderRadius: 4, fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                  wordBreak: "break-all",
                }}>{finding.dedup_key}</code>
              </div>
            )}
            {!finding.agent_id && !finding.dedup_key && (
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                No agent trace data. This finding may have been imported manually.
              </div>
            )}
            <div style={{ marginTop: 16, padding: 12, background: "var(--panel)", borderRadius: 6, border: "1px solid var(--border)" }}>
              <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
                Full agent execution traces are available in <ChevronRight size={9} style={{ verticalAlign: "middle" }} /> Jobs page when this finding was produced by a campaign run.
              </p>
            </div>
          </div>
        )}

        {/* ── Remediation ── */}
        {tab === "remediation" && (
          <div>
            {finding.remediation ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>REMEDIATION GUIDANCE</div>
                <div style={{
                  fontSize: 12, lineHeight: 1.7,
                  background: "var(--panel)", border: "1px solid var(--border)",
                  borderRadius: 4, padding: "10px 12px",
                }}>{finding.remediation}</div>
              </div>
            ) : (
              <div style={{ marginBottom: 16, padding: 12, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6 }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                  No remediation data stored. Add via PATCH /api/v1/vulnerabilities/{finding.id}.
                </p>
              </div>
            )}

            {finding.cwe && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>CWE REFERENCE</div>
                <a
                  href={`https://cwe.mitre.org/data/definitions/${finding.cwe.replace("CWE-", "")}.html`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: "var(--accent)", fontSize: 12, textDecoration: "none" }}
                >
                  {finding.cwe} — MITRE CWE Database <ExternalLink size={10} />
                </a>
              </div>
            )}

            {finding.cve && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>CVE DETAIL</div>
                <a
                  href={`https://nvd.nist.gov/vuln/detail/${finding.cve}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: "var(--accent)", fontSize: 12, textDecoration: "none" }}
                >
                  {finding.cve} — NVD <ExternalLink size={10} />
                </a>
              </div>
            )}

            {(finding.references?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>REFERENCES</div>
                <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                  {finding.references!.map((ref, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <a href={ref} target="_blank" rel="noopener noreferrer"
                        style={{ color: "var(--accent)", fontSize: 11, wordBreak: "break-all" }}>
                        {ref}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Findings() {
  const [rows, setRows] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Finding | null>(null);

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
    ? rows.filter((r) =>
        r.name.toLowerCase().includes(filter.toLowerCase()) ||
        (r.host ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        (r.category ?? "").toLowerCase().includes(filter.toLowerCase())
      )
    : rows;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── Table pane ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="page-toolbar">
          <div className="page-title">
            <Flag size={16} />
            <span>Findings</span>
            <small>{filtered.length}</small>
          </div>
          <div className="toolbar-actions">
            <div className="filter-input-wrap">
              <Filter size={13} />
              <input
                placeholder="Filter findings…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
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
                      <tr
                        key={f.id}
                        className="data-row"
                        onClick={() => setSelected(selected?.id === f.id ? null : f)}
                        style={{
                          borderLeft: `3px solid ${SEV_COLOR[f.severity] ?? "var(--muted)"}`,
                          cursor: "pointer",
                          background: selected?.id === f.id ? "var(--panel-2)" : undefined,
                        }}
                      >
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

      {/* ── Detail panel ── */}
      {selected && (
        <FindingPanel finding={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
