import { useEffect, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Capability = {
  id: string;
  subject_type: string;
  subject_id: string;
  permissions: string[];
  expires_at: string | null;
  issued_at: string;
};

export default function Secrets() {
  const [caps, setCaps] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const key = getApiKey();
      const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
      const pr = await fetch("/api/v1/projects", { headers });
      const projects = pr.ok ? await pr.json() : [];
      const pid: string = projects[0]?.id ?? "";
      setProjectId(pid);
      if (!pid) { setLoading(false); return; }
      const r = await fetch(`/api/v1/projects/${pid}/capabilities`, { headers });
      const data = r.ok ? await r.json() : [];
      setCaps(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, []);

  async function revoke(id: string) {
    setRevoking(id);
    try {
      const key = getApiKey();
      const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
      await fetch(`/api/v1/capabilities/${id}/revoke`, { method: "POST", headers });
      await load();
    } catch {
      // ignore
    } finally {
      setRevoking(null);
    }
  }

  function isExpired(expiresAt: string | null): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <KeyRound size={16} />
          <span>Secrets</span>
          <small>{caps.length} tokens</small>
        </div>
        <div className="toolbar-actions">
          <button className="action-btn" onClick={load} disabled={loading}>
            <RefreshCw size={13} style={{ marginRight: 4 }} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading capability tokens…</div>
      ) : caps.length === 0 ? (
        <div className="empty-state-block">
          <p>No capability tokens issued for this project.</p>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Permissions</th>
                <th>Expires</th>
                <th>Issued</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {caps.map((cap) => {
                const expired = isExpired(cap.expires_at);
                return (
                  <tr key={cap.id} className="data-row" style={{ opacity: expired ? 0.5 : 1 }}>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <code className="type-badge">{cap.subject_type}</code>
                        <span className="mono-cell" style={{ fontSize: 10 }}>
                          {cap.subject_id.slice(0, 16)}{cap.subject_id.length > 16 ? "…" : ""}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {(cap.permissions ?? []).map((perm) => (
                          <code key={perm} className="type-badge">{perm}</code>
                        ))}
                        {(!cap.permissions || cap.permissions.length === 0) && (
                          <span className="muted-cell">—</span>
                        )}
                      </div>
                    </td>
                    <td className="time-cell" style={{ color: expired ? "var(--bad)" : "var(--muted)" }}>
                      {cap.expires_at
                        ? new Date(cap.expires_at).toLocaleString()
                        : <span className="muted-cell">never</span>}
                      {expired && (
                        <span style={{ marginLeft: 6, fontFamily: "JetBrains Mono, monospace", fontSize: 9, color: "var(--bad)" }}>
                          EXPIRED
                        </span>
                      )}
                    </td>
                    <td className="time-cell">{new Date(cap.issued_at).toLocaleString()}</td>
                    <td>
                      <button
                        className="action-btn"
                        style={{ color: "var(--bad)", borderColor: "var(--bad)" }}
                        onClick={() => revoke(cap.id)}
                        disabled={revoking === cap.id}
                      >
                        {revoking === cap.id ? "Revoking…" : "Revoke"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
