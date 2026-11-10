import { useEffect, useState } from "react";
import { Wrench, X as XIcon } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Capability = {
  id: string;
  subject_type: string;
  subject_id: string;
  permissions: string[];
  expires_at: string | null;
  issued_at: string;
};

type Execution = {
  id: string;
  project_id: string;
  kind: string;
  status: string;
  risk_class: string | null;
  created_at: string;
  finished_at: string | null;
  error: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  running: "var(--warn)",
  completed: "var(--good)",
  failed: "var(--bad)",
  pending: "var(--muted)",
  queued: "var(--info)",
};

function isExpired(expires_at: string | null): boolean {
  if (!expires_at) return false;
  return new Date(expires_at) < new Date();
}

export default function ToolCenter() {
  const [projectId, setProjectId] = useState("");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [subjectType, setSubjectType] = useState("tool");
  const [subjectId, setSubjectId] = useState("");
  const [permissionsStr, setPermissionsStr] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function fetchAll() {
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
    try {
      const projRes = await fetch("/api/v1/projects", { headers });
      const projs = projRes.ok ? await projRes.json() : [];
      const pid: string = projs[0]?.id ?? "";
      setProjectId(pid);

      const [capRes, execRes] = await Promise.all([
        pid ? fetch(`/api/v1/projects/${pid}/capabilities`, { headers }) : Promise.resolve(null),
        fetch("/api/v1/executions?limit=20", { headers }),
      ]);

      const caps: Capability[] = capRes?.ok ? await capRes.json() : [];
      const execs: Execution[] = execRes.ok ? await execRes.json() : [];
      setCapabilities(caps);
      setExecutions(execs);
    } catch {
      // keep state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

    async function fetchData() {
      try {
        const projRes = await fetch("/api/v1/projects", { headers });
        const projs = projRes.ok ? await projRes.json() : [];
        const pid: string = projs[0]?.id ?? "";
        if (cancelled) return;
        setProjectId(pid);

        const [capRes, execRes] = await Promise.all([
          pid ? fetch(`/api/v1/projects/${pid}/capabilities`, { headers }) : Promise.resolve(null),
          fetch("/api/v1/executions?limit=20", { headers }),
        ]);

        const caps: Capability[] = capRes?.ok ? await capRes.json() : [];
        const execs: Execution[] = execRes.ok ? await execRes.json() : [];
        if (!cancelled) {
          setCapabilities(caps);
          setExecutions(execs);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  async function revoke(capId: string) {
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const r = await fetch(`/api/v1/capabilities/${capId}/revoke`, { method: "POST", headers });
      if (r.ok) {
        setCapabilities((prev) => prev.filter((c) => c.id !== capId));
        showToast("Capability revoked");
      } else {
        showToast("Revoke failed");
      }
    } catch {
      showToast("Revoke failed — check API connection");
    }
  }

  async function issueCapability() {
    if (!subjectId.trim()) return;
    if (!projectId) { showToast("No project loaded"); return; }
    setIssuing(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    const permissions = permissionsStr.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      const r = await fetch(`/api/v1/projects/${projectId}/capabilities`, {
        method: "POST",
        headers,
        body: JSON.stringify({ subject_type: subjectType, subject_id: subjectId.trim(), permissions }),
      });
      if (r.ok) {
        const cap = await r.json();
        setCapabilities((prev) => [cap, ...prev]);
        setShowModal(false);
        setSubjectId("");
        setPermissionsStr("");
        showToast("Capability issued");
      } else {
        const err = await r.json().catch(() => ({ message: r.statusText }));
        showToast(`Error: ${err?.message ?? r.statusText}`);
      }
    } catch {
      showToast("Issue failed — check API connection");
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="page-targets">
      {toast && (
        <div
          style={{
            position: "fixed", top: 16, right: 16, zIndex: 9999,
            background: "var(--panel-2)", border: "1px solid var(--accent)",
            color: "var(--accent)", padding: "10px 16px", borderRadius: 6,
            fontFamily: "JetBrains Mono, monospace", fontSize: 12,
          }}
        >
          {toast}
        </div>
      )}

      <div className="page-toolbar">
        <div className="page-title">
          <Wrench size={16} />
          <span>Tool Center</span>
          <small>{capabilities.length} capabilities</small>
        </div>
        <div className="toolbar-actions">
          <button className="action-btn primary" onClick={() => setShowModal(true)}>
            + Issue Capability
          </button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* Capabilities table */}
          {capabilities.length === 0 ? (
            <div className="empty-state-block">
              <p>No capabilities issued for this project.</p>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Type</th>
                    <th>Permissions</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {capabilities.map((c) => {
                    const expired = isExpired(c.expires_at);
                    return (
                      <tr key={c.id} className="data-row">
                        <td><code className="mono-cell">{c.subject_id}</code></td>
                        <td><code className="type-badge">{c.subject_type}</code></td>
                        <td>
                          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--muted)" }}>
                            {(c.permissions ?? []).join(", ") || "—"}
                          </span>
                        </td>
                        <td className="time-cell">
                          {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "Never"}
                        </td>
                        <td>
                          <span style={{ color: expired ? "var(--muted)" : "var(--good)", fontWeight: 500, fontSize: 12 }}>
                            {expired ? "expired" : "active"}
                          </span>
                        </td>
                        <td>
                          {!expired && (
                            <button
                              className="action-btn"
                              style={{ color: "var(--bad)", borderColor: "var(--bad)", fontSize: 11 }}
                              onClick={() => revoke(c.id)}
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent executions section */}
          <div
            style={{
              padding: "16px 20px 8px",
              borderTop: capabilities.length > 0 ? "1px solid var(--border)" : undefined,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              Recent Executions
            </div>
          </div>
          {executions.length === 0 ? (
            <div className="empty-state-block" style={{ paddingTop: 0 }}>
              <p>No recent executions.</p>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((e) => (
                    <tr key={e.id} className="data-row">
                      <td><code className="mono-cell">{e.id.slice(0, 14)}…</code></td>
                      <td><code className="type-badge">{e.kind}</code></td>
                      <td>
                        <span style={{ color: STATUS_COLOR[e.status] ?? "var(--muted)", fontWeight: 500, fontSize: 12 }}>
                          {e.status}
                        </span>
                      </td>
                      <td className="muted-cell">{e.risk_class ?? "—"}</td>
                      <td className="time-cell">{new Date(e.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(ev) => ev.stopPropagation()} style={{ width: 440 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Issue Capability</span>
              <button className="action-btn" style={{ padding: "2px 6px" }} onClick={() => setShowModal(false)}>
                <XIcon size={13} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Subject Type</label>
                <select
                  style={{
                    width: "100%", background: "var(--panel-2)", border: "1px solid var(--border)",
                    color: "var(--text)", padding: "7px 10px", borderRadius: 4, fontSize: 13,
                    fontFamily: "inherit", boxSizing: "border-box",
                  }}
                  value={subjectType}
                  onChange={(e) => setSubjectType(e.target.value)}
                >
                  <option value="tool">tool</option>
                  <option value="agent">agent</option>
                  <option value="webhook">webhook</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Subject ID</label>
                <input
                  style={{
                    width: "100%", background: "var(--panel-2)", border: "1px solid var(--border)",
                    color: "var(--text)", padding: "7px 10px", borderRadius: 4, fontSize: 13,
                    fontFamily: "JetBrains Mono, monospace", boxSizing: "border-box",
                  }}
                  placeholder="tool-id or agent-name"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                  Permissions <span style={{ color: "var(--muted)", fontSize: 10 }}>(comma-separated)</span>
                </label>
                <input
                  style={{
                    width: "100%", background: "var(--panel-2)", border: "1px solid var(--border)",
                    color: "var(--text)", padding: "7px 10px", borderRadius: 4, fontSize: 13,
                    fontFamily: "JetBrains Mono, monospace", boxSizing: "border-box",
                  }}
                  placeholder="read, write, execute"
                  value={permissionsStr}
                  onChange={(e) => setPermissionsStr(e.target.value)}
                />
              </div>
              <button
                className="action-btn primary"
                style={{ alignSelf: "flex-end", padding: "7px 20px", fontSize: 13 }}
                disabled={issuing || !subjectId.trim()}
                onClick={issueCapability}
              >
                {issuing ? "Issuing…" : "Issue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
