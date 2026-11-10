import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { getApiKey } from "../../lib/api";

type ScopeRule = {
  id: string;
  pattern: string;
  scope_type: string;
  active: boolean;
};

type EvalResult = {
  in_scope: boolean;
  matched_rule: string | null;
  reason: string;
} | null;

export default function ScopeGuard() {
  const [rules, setRules] = useState<ScopeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [noEngagement, setNoEngagement] = useState(false);
  const [checkUrl, setCheckUrl] = useState("");
  const [evalResult, setEvalResult] = useState<EvalResult>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const key = getApiKey();
        const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

        // Fetch projects
        const pr = await fetch("/api/v1/projects", { headers });
        const projects = pr.ok ? await pr.json() : [];
        const pid: string = projects[0]?.id ?? "";
        if (!cancelled) setProjectId(pid);
        if (!pid) { if (!cancelled) { setNoEngagement(true); setLoading(false); } return; }

        // Fetch engagements for this project
        const er = await fetch(`/api/v1/projects/${pid}/engagements`, { headers });
        const engagements = er.ok ? await er.json() : [];
        const engId: string = engagements[0]?.id ?? "";

        if (!engId) {
          if (!cancelled) { setNoEngagement(true); setLoading(false); }
          return;
        }

        // Fetch scope rules for this engagement
        const sr = await fetch(`/api/v1/engagements/${engId}/scope`, { headers });
        const data = sr.ok ? await sr.json() : [];
        if (!cancelled) {
          setRules(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function evaluateUrl() {
    if (!checkUrl.trim()) return;
    setEvaluating(true);
    setEvalResult(null);
    try {
      const key = getApiKey();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(key ? { "X-Api-Key": key } : {}),
      };
      const body: Record<string, string> = { url: checkUrl.trim() };
      if (projectId) body.project_id = projectId;
      const r = await fetch("/api/v1/scope/evaluate", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = r.ok ? await r.json() : null;
      setEvalResult(data);
    } catch {
      setEvalResult(null);
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <ShieldAlert size={16} />
          <span>ScopeGuard</span>
          {!noEngagement && <small>{rules.length} rules</small>}
        </div>
      </div>

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
        {/* URL evaluator */}
        <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "16px 20px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            URL Scope Check
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="https://target.example.com/api/v1/users"
              value={checkUrl}
              onChange={(e) => setCheckUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && evaluateUrl()}
              style={{
                flex: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4,
                padding: "0 12px", height: 32, color: "var(--text)",
                fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                outline: "none",
              }}
            />
            <button
              className="action-btn primary"
              onClick={evaluateUrl}
              disabled={evaluating || !checkUrl.trim()}
            >
              {evaluating ? "Checking…" : "Check"}
            </button>
          </div>

          {evalResult && (
            <div style={{
              marginTop: 12, padding: "12px 16px", borderRadius: 4,
              background: "var(--bg)", border: `1px solid ${evalResult.in_scope ? "var(--good)" : "var(--bad)"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{
                  fontFamily: "JetBrains Mono, monospace", fontSize: 12, fontWeight: 600,
                  color: evalResult.in_scope ? "var(--good)" : "var(--bad)",
                }}>
                  {evalResult.in_scope ? "IN SCOPE" : "OUT OF SCOPE"}
                </span>
                {evalResult.matched_rule && (
                  <code style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--muted)" }}>
                    rule: {evalResult.matched_rule}
                  </code>
                )}
              </div>
              {evalResult.reason && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{evalResult.reason}</div>
              )}
            </div>
          )}
        </div>

        {/* Scope rules table */}
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Scope Rules
          </div>

          {loading ? (
            <div className="page-loading">Loading scope rules…</div>
          ) : noEngagement ? (
            <div className="empty-state-block">
              <p>No active engagement — set one up first to manage scope rules.</p>
            </div>
          ) : rules.length === 0 ? (
            <div className="empty-state-block">
              <p>No scope rules defined for this engagement.</p>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pattern</th>
                    <th>Type</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="data-row">
                      <td><code className="mono-cell">{rule.pattern}</code></td>
                      <td><code className="type-badge">{rule.scope_type}</code></td>
                      <td>
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: rule.active ? "var(--good)" : "var(--muted)" }}>
                          {rule.active ? "yes" : "no"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
