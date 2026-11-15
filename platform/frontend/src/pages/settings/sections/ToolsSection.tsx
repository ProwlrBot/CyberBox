import { useEffect, useState } from "react";
import { getApiKey } from "../../../lib/api";

type Tool = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  danger_tier: string;
  approval: string;
  enabled: number;
};

const TIER_COLOR: Record<string, string> = {
  passive: "var(--good)",
  active: "var(--warn)",
  exploit: "var(--bad)",
};

export function ToolsSection() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const key = getApiKey();
    fetch("/api/v1/tools/registry", { headers: key ? { "X-Api-Key": key } : {} })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Tool[]) => setTools(Array.isArray(rows) ? rows : []))
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }, []);

  const enabled = tools.filter((t) => t.enabled).length;

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Tools</h2>
      <p className="settings-section-desc">
        Registered security tools and their policy risk tier. {tools.length} registered · {enabled} enabled.
      </p>

      {loading ? (
        <p className="empty-state">Loading tool registry…</p>
      ) : tools.length === 0 ? (
        <p className="empty-state">
          No tools registered yet. Import an inventory via <code style={{ color: "var(--accent)" }}>POST /tools/registry/import</code>.
        </p>
      ) : (
        <div className="data-table-wrap" style={{ maxHeight: 460 }}>
          <table className="data-table">
            <thead>
              <tr><th>Tool</th><th>Category</th><th>Risk tier</th><th>Approval</th><th>Status</th></tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.id} className="data-row">
                  <td style={{ fontSize: 12 }}>
                    <strong>{t.name}</strong>
                    {t.description && (
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{t.description}</div>
                    )}
                  </td>
                  <td><span className="type-badge">{t.category}</span></td>
                  <td>
                    <span className="sev-badge" style={{ color: TIER_COLOR[t.danger_tier] ?? "var(--muted)" }}>
                      {t.danger_tier}
                    </span>
                  </td>
                  <td className="mono-cell">{t.approval}</td>
                  <td>
                    <span style={{ color: t.enabled ? "var(--good)" : "var(--muted)", fontSize: 11 }}>
                      {t.enabled ? "● enabled" : "○ disabled"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
