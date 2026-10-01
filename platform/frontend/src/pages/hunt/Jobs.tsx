import { useEffect, useState } from "react";
import { CheckCircle2, Cpu, X as XIcon } from "lucide-react";
import { fetchPendingApprovals } from "../../lib/api";
import { getApiKey } from "../../lib/api";

type Approval = { id: string; execution_id: string; action_class: string; status: string; expires_at: string };

export default function Jobs() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchPendingApprovals().then((data) => {
      if (!cancelled) { setApprovals(data); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function decide(id: string, decision: "approved" | "denied") {
    const key = getApiKey();
    await fetch(`/api/v1/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Api-Key": key } : {}) },
      body: JSON.stringify({ status: decision }),
    });
    setApprovals((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Cpu size={16} />
          <span>Jobs</span>
          <small>{approvals.length} pending</small>
        </div>
      </div>

      {loading
        ? <div className="page-loading">Loading…</div>
        : approvals.length === 0
          ? <div className="empty-state-block"><p>No pending approvals. Jobs run in the background.</p></div>
          : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Execution</th><th>Action class</th><th>Expires</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((a) => (
                    <tr key={a.id} className="data-row">
                      <td><code className="mono-cell">{a.execution_id.slice(0, 12)}…</code></td>
                      <td><code className="type-badge">{a.action_class}</code></td>
                      <td className="time-cell">{new Date(a.expires_at).toLocaleString()}</td>
                      <td>
                        <button className="action-btn primary" style={{ marginRight: 6 }} onClick={() => decide(a.id, "approved")}>
                          <CheckCircle2 size={13} /> Approve
                        </button>
                        <button className="action-btn" onClick={() => decide(a.id, "denied")}>
                          <XIcon size={13} /> Deny
                        </button>
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
