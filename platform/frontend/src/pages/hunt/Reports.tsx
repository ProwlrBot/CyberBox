import { useEffect, useState } from "react";
import { BarChart2, Download } from "lucide-react";
import { getApiKey } from "../../lib/api";

const SEV_COLOR: Record<string, string> = {
  critical: "var(--bad)", high: "var(--warn)", medium: "#fcd34d",
  low: "var(--good)", info: "var(--info)",
};

const SEV_ORDER = ["critical", "high", "medium", "low", "info"];

type Vuln = {
  id: string;
  name: string;
  severity: string;
  category: string;
  host: string;
  status: string;
  verified: boolean;
  detected_at: string;
};

export default function Reports() {
  const [rows, setRows] = useState<Vuln[]>([]);
  const [loading, setLoading] = useState(true);
  const [sevFilter, setSevFilter] = useState("ALL");
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
        const r = await fetch(`/api/v1/projects/${pid}/vulnerabilities`, { headers });
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

  const filtered = sevFilter === "ALL"
    ? rows
    : rows.filter((r) => r.severity?.toLowerCase() === sevFilter.toLowerCase());

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exportCSV() {
    const cols = ["id", "severity", "name", "category", "host", "status", "verified", "detected_at"];
    const header = cols.join(",");
    const escapeCell = (v: unknown) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = filtered.map((r) =>
      cols.map((c) => escapeCell(r[c as keyof Vuln])).join(",")
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vulnerabilities-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const chips = [
    { label: "ALL", value: "ALL" },
    { label: "CRIT", value: "critical" },
    { label: "HIGH", value: "high" },
    { label: "MED", value: "medium" },
    { label: "LOW", value: "low" },
  ];

  const sortedFiltered = [...filtered].sort((a, b) => {
    const ai = SEV_ORDER.indexOf(a.severity?.toLowerCase());
    const bi = SEV_ORDER.indexOf(b.severity?.toLowerCase());
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <BarChart2 size={16} />
          <span>Reports</span>
          <small>{filtered.length} vulns</small>
        </div>
        <div className="toolbar-actions">
          <div style={{ display: "flex", gap: 4 }}>
            {chips.map((c) => (
              <button
                key={c.value}
                className="action-btn"
                onClick={() => setSevFilter(c.value)}
                style={{
                  color: c.value !== "ALL" ? (SEV_COLOR[c.value] ?? "var(--muted)") : "var(--text)",
                  borderColor: sevFilter === c.value ? (c.value !== "ALL" ? SEV_COLOR[c.value] : "var(--accent)") : "var(--border)",
                  background: sevFilter === c.value ? "var(--panel-2)" : "transparent",
                  fontWeight: sevFilter === c.value ? 700 : 400,
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <button className="action-btn" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {loading
        ? <div className="page-loading">Loading…</div>
        : sortedFiltered.length === 0
          ? (
            <div className="empty-state-block">
              <p>No vulnerabilities reported yet — submit findings to populate this list</p>
            </div>
          )
          : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Host</th>
                    <th>Status</th>
                    <th>Verified</th>
                    <th>Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFiltered.map((v) => {
                    const isOpen = expanded.has(v.id);
                    return (
                      <>
                        <tr
                          key={v.id}
                          className="data-row"
                          style={{
                            cursor: "pointer",
                            borderLeft: `3px solid ${SEV_COLOR[v.severity?.toLowerCase()] ?? "var(--muted)"}`,
                          }}
                          onClick={() => toggleRow(v.id)}
                        >
                          <td>
                            <span
                              className="sev-badge"
                              style={{ color: SEV_COLOR[v.severity?.toLowerCase()] ?? "var(--muted)" }}
                            >
                              {v.severity?.toUpperCase() ?? "—"}
                            </span>
                          </td>
                          <td>
                            <strong style={{ color: isOpen ? "var(--accent)" : "var(--text)" }}>
                              {v.name}
                            </strong>
                          </td>
                          <td className="muted-cell">{v.category ?? "—"}</td>
                          <td className="mono-cell">{v.host ?? "—"}</td>
                          <td>
                            <code className="type-badge">{v.status ?? "—"}</code>
                          </td>
                          <td style={{ color: v.verified ? "var(--good)" : "var(--muted)" }}>
                            {v.verified ? "✓" : "—"}
                          </td>
                          <td className="time-cell">
                            {v.detected_at ? new Date(v.detected_at).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${v.id}-expand`} style={{ background: "var(--panel-2)" }}>
                            <td colSpan={7} style={{ padding: "12px 16px" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 12 }}>
                                <div>
                                  <div style={{ color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", fontSize: 10 }}>ID</div>
                                  <code style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--text)" }}>{v.id}</code>
                                </div>
                                <div>
                                  <div style={{ color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", fontSize: 10 }}>Category</div>
                                  <span style={{ color: "var(--text)" }}>{v.category ?? "—"}</span>
                                </div>
                                <div>
                                  <div style={{ color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", fontSize: 10 }}>Host</div>
                                  <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--text)" }}>{v.host ?? "—"}</span>
                                </div>
                                <div>
                                  <div style={{ color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", fontSize: 10 }}>Status</div>
                                  <span style={{ color: "var(--text)" }}>{v.status ?? "—"}</span>
                                </div>
                                <div>
                                  <div style={{ color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", fontSize: 10 }}>Verified</div>
                                  <span style={{ color: v.verified ? "var(--good)" : "var(--muted)" }}>
                                    {v.verified ? "Yes" : "No"}
                                  </span>
                                </div>
                                <div>
                                  <div style={{ color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", fontSize: 10 }}>Detected</div>
                                  <span style={{ color: "var(--text)" }}>
                                    {v.detected_at ? new Date(v.detected_at).toLocaleString() : "—"}
                                  </span>
                                </div>
                              </div>
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
