import { useEffect, useState } from "react";
import { getApiKey } from "../../../lib/api";

type Engagement = { id: string; name: string; status?: string; profile_id?: string };
type ScopeRule = { id: string; pattern: string; effect: string; risk_class?: string; method?: string };
type Ack = { id: string; created_at: string };

const ENGAGEMENT_KEY = "cyberbox.engagement.v1";

export function EngagementSection() {
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [scope, setScope] = useState<ScopeRule[]>([]);
  const [acks, setAcks] = useState<Ack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

    (async () => {
      try {
        const projs = await fetch("/api/v1/projects", { headers }).then((r) => (r.ok ? r.json() : []));
        const pid = projs[0]?.id;
        if (!pid) return;
        const engs: Engagement[] = await fetch(`/api/v1/projects/${encodeURIComponent(pid)}/engagements`, { headers })
          .then((r) => (r.ok ? r.json() : []));
        const preferred = localStorage.getItem(ENGAGEMENT_KEY);
        const eng = engs.find((e) => e.id === preferred) ?? engs[0];
        if (!eng || cancelled) return;
        setEngagement(eng);
        const [sc, ak] = await Promise.all([
          fetch(`/api/v1/engagements/${encodeURIComponent(eng.id)}/scope`, { headers }).then((r) => (r.ok ? r.json() : [])),
          fetch(`/api/v1/engagements/${encodeURIComponent(eng.id)}/acknowledgments`, { headers }).then((r) => (r.ok ? r.json() : [])),
        ]);
        if (cancelled) return;
        setScope(Array.isArray(sc) ? sc : []);
        setAcks(Array.isArray(ak) ? ak : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Engagement</h2>
      <p className="settings-section-desc">Scope, authorization, and policy for the active engagement.</p>

      {loading ? (
        <p className="empty-state">Loading engagement…</p>
      ) : !engagement ? (
        <p className="empty-state">No engagement found — create a project and engagement first.</p>
      ) : (
        <div style={{ display: "grid", gap: 20, maxWidth: 640 }}>
          <div className="about-dl" style={{ gridTemplateColumns: "max-content 1fr" }}>
            <dt>Engagement</dt><dd>{engagement.name}</dd>
            <dt>Status</dt>
            <dd style={{ color: engagement.status === "active" || engagement.status === "authorized" ? "var(--good)" : "var(--warn)" }}>
              {engagement.status ?? "unknown"}
            </dd>
            {engagement.profile_id && (<><dt>Profile</dt><dd>{engagement.profile_id}</dd></>)}
            <dt>Acknowledgments</dt><dd>{acks.length}</dd>
          </div>

          <div>
            <div className="settings-subnav-label" style={{ padding: "0 0 10px" }}>
              Scope rules ({scope.length})
            </div>
            {scope.length === 0 ? (
              <p className="empty-state">
                No scope rules defined. Without an in-scope rule, live network actions are denied by default.
              </p>
            ) : (
              <div className="data-table-wrap" style={{ maxHeight: 320, border: "1px solid var(--border)", borderRadius: 5 }}>
                <table className="data-table">
                  <thead>
                    <tr><th>Effect</th><th>Pattern</th><th>Risk class</th><th>Method</th></tr>
                  </thead>
                  <tbody>
                    {scope.map((s) => (
                      <tr key={s.id} className="data-row">
                        <td>
                          <span className="sev-badge" style={{ color: s.effect === "allow" ? "var(--good)" : "var(--bad)" }}>
                            {s.effect}
                          </span>
                        </td>
                        <td><code className="mono-cell">{s.pattern}</code></td>
                        <td className="muted-cell">{s.risk_class ?? "—"}</td>
                        <td className="muted-cell">{s.method ?? "any"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
