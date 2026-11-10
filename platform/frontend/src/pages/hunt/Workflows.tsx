import { useEffect, useState } from "react";
import { Workflow, X as XIcon } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Playbook = {
  id: string;
  name: string;
  description?: string;
  profile_id?: string;
  steps?: unknown[];
};

type ModalState = { playbook: Playbook } | null;

export default function Workflows() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);
  const [engagementId, setEngagementId] = useState("");
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const key = getApiKey();
      const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
      try {
        const r = await fetch("/api/v1/playbooks", { headers });
        const data = r.ok ? await r.json() : [];
        if (!cancelled) setPlaybooks(Array.isArray(data) ? data : []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function runPlaybook() {
    if (!modal || !engagementId.trim()) return;
    setRunning(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const r = await fetch(`/api/v1/playbooks/${modal.playbook.id}/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ engagement_id: engagementId.trim(), inputs: {} }),
      });
      if (r.ok) {
        const d = await r.json();
        setToast(`Playbook started — run ID: ${d.id ?? "unknown"}`);
        setModal(null);
        setEngagementId("");
        setTimeout(() => setToast(""), 5000);
      } else {
        setToast("Failed to start playbook");
        setTimeout(() => setToast(""), 4000);
      }
    } catch {
      setToast("Error starting playbook");
      setTimeout(() => setToast(""), 4000);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Workflow size={16} />
          <span>Workflows</span>
          <small>{playbooks.length} playbooks</small>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : playbooks.length === 0 ? (
        <div className="empty-state-block">
          <p>No playbooks available for this profile</p>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 14,
          }}>
            {playbooks.map((pb) => (
              <div
                key={pb.id}
                style={{
                  background: "var(--panel)", border: "1px solid var(--border)",
                  borderRadius: 6, padding: 16,
                  display: "flex", flexDirection: "column", gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                    {pb.name}
                  </span>
                  {pb.profile_id && (
                    <code className="type-badge" style={{ flexShrink: 0 }}>{pb.profile_id}</code>
                  )}
                </div>
                {pb.description && (
                  <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                    {pb.description}
                  </p>
                )}
                <div style={{ marginTop: "auto" }}>
                  <button
                    className="action-btn primary"
                    onClick={() => { setModal({ playbook: pb }); setEngagementId(""); }}
                    style={{ width: "100%" }}
                  >
                    Run
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 32 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Recent Runs
            </div>
            <div className="empty-state-block" style={{ border: "1px solid var(--border)", borderRadius: 4 }}>
              <p>No recent runs — run a playbook above to start</p>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div className="modal" style={{ minWidth: 360 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Run: {modal.playbook.name}</span>
              <button
                className="action-btn"
                onClick={() => setModal(null)}
                style={{ padding: "0 8px" }}
              >
                <XIcon size={13} />
              </button>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase" }}>
                Engagement ID <span style={{ color: "var(--bad)" }}>*</span>
              </label>
              <input
                value={engagementId}
                onChange={(e) => setEngagementId(e.target.value)}
                placeholder="e.g. eng-abc123"
                style={{
                  width: "100%", height: 32, background: "var(--panel-2)",
                  border: "1px solid var(--border)", color: "var(--text)",
                  fontSize: 12, padding: "0 10px", borderRadius: 4, boxSizing: "border-box",
                  fontFamily: "JetBrains Mono, monospace",
                }}
                onKeyDown={(e) => { if (e.key === "Enter") runPlaybook(); }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="action-btn" onClick={() => setModal(null)}>Cancel</button>
              <button
                className="action-btn primary"
                onClick={runPlaybook}
                disabled={running || !engagementId.trim()}
              >
                {running ? "Starting…" : "Run"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          background: "var(--panel)", border: "1px solid var(--border)",
          borderRadius: 6, padding: "10px 16px", fontSize: 12,
          fontFamily: "JetBrains Mono, monospace", color: "var(--good)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
