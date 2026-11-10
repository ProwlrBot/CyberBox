import { useEffect, useState } from "react";
import { Heart, RefreshCw } from "lucide-react";
import { getApiKey } from "../../lib/api";

type HealthData = {
  status: string;
  database: string;
  version: string;
};

type RuntimeData = {
  project?: { id: string; name: string };
  engagement?: { id: string; name: string };
  profile?: { id: string; name: string };
  [key: string]: unknown;
};

export default function Health() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [runtime, setRuntime] = useState<RuntimeData | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    try {
      const key = getApiKey();
      const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

      // Fetch health
      const hr = await fetch("/api/v1/health", { headers });
      const hData: HealthData = hr.ok ? await hr.json() : { status: "error", database: "error", version: "unknown" };
      setHealth(hData);

      // Fetch projects to get project id for runtime
      const pr = await fetch("/api/v1/projects", { headers });
      const projects = pr.ok ? await pr.json() : [];
      const projectId: string = projects[0]?.id ?? "";

      // Fetch runtime
      if (projectId) {
        const rr = await fetch(`/api/v1/runtime?project_id=${projectId}`, { headers });
        const rData: RuntimeData = rr.ok ? await rr.json() : {};
        setRuntime(rData);
      }

      // Fetch pending approvals count
      const ar = await fetch("/api/v1/approvals?status=pending", { headers });
      const approvals = ar.ok ? await ar.json() : [];
      setPendingApprovals(Array.isArray(approvals) ? approvals.length : 0);

      setLastChecked(new Date());
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

  const statusOk = health?.status === "ok";
  const dbOk = health?.database === "ok";

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Heart size={16} />
          <span>Health</span>
        </div>
        <div className="toolbar-actions">
          {lastChecked && (
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--muted)" }}>
              Checked {lastChecked.toLocaleTimeString()}
            </span>
          )}
          <button className="action-btn" onClick={load} disabled={loading}>
            <RefreshCw size={13} style={{ marginRight: 4 }} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Checking system health…</div>
      ) : (
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Stat cells row */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {/* Server status */}
            <div style={{
              background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6,
              padding: "14px 20px", minWidth: 140
            }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                Server
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: statusOk ? "var(--good)" : "var(--bad)",
                  display: "inline-block", flexShrink: 0
                }} />
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: statusOk ? "var(--good)" : "var(--bad)" }}>
                  {health?.status ?? "unknown"}
                </span>
              </div>
            </div>

            {/* Database status */}
            <div style={{
              background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6,
              padding: "14px 20px", minWidth: 140
            }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                Database
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: dbOk ? "var(--good)" : "var(--bad)",
                  display: "inline-block", flexShrink: 0
                }} />
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: dbOk ? "var(--good)" : "var(--bad)" }}>
                  {health?.database ?? "unknown"}
                </span>
              </div>
            </div>

            {/* Version */}
            <div style={{
              background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6,
              padding: "14px 20px", minWidth: 140
            }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                Version
              </div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--text)" }}>
                {health?.version ?? "—"}
              </div>
            </div>

            {/* Pending approvals */}
            <div style={{
              background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6,
              padding: "14px 20px", minWidth: 140
            }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                Pending Approvals
              </div>
              <div style={{
                fontFamily: "JetBrains Mono, monospace", fontSize: 13,
                color: pendingApprovals > 0 ? "var(--warn)" : "var(--good)"
              }}>
                {pendingApprovals}
              </div>
            </div>
          </div>

          {/* Runtime summary */}
          {runtime && (
            <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "16px 20px" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                Runtime Context
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {runtime.project && (
                  <div style={{ display: "flex", gap: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)", width: 100 }}>Project</span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--text)" }}>
                      {runtime.project.name}
                    </span>
                    <code style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--muted)" }}>
                      {runtime.project.id}
                    </code>
                  </div>
                )}
                {runtime.engagement && (
                  <div style={{ display: "flex", gap: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)", width: 100 }}>Engagement</span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--text)" }}>
                      {runtime.engagement.name}
                    </span>
                  </div>
                )}
                {runtime.profile && (
                  <div style={{ display: "flex", gap: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)", width: 100 }}>Profile</span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--text)" }}>
                      {runtime.profile.name}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
