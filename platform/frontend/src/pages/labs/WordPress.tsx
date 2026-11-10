import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { getApiKey } from "../../lib/api";

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

const WP_TIPS = [
  { label: "xmlrpc.php", detail: "POST /xmlrpc.php — brute-force via system.multicall, SSRF, amplification DoS" },
  { label: "wp-json/wp/v2/users", detail: "GET /wp-json/wp/v2/users — enumerates author logins without auth" },
  { label: "wp-admin default creds", detail: "admin:admin, admin:password, admin:123456 — always try before tooling" },
  { label: "Plugin CVEs", detail: "Search WPScan DB, Patchstack, NVD for installed plugin versions via /wp-json/wp/v2/plugins" },
  { label: "wp-config.php backup", detail: "Try wp-config.php.bak, wp-config.php~, wp-config.php.old in webroot" },
  { label: "debug.log exposure", detail: "GET /wp-content/debug.log — often world-readable, leaks stack traces and secrets" },
  { label: "Unauthenticated REST", detail: "/wp-json/wp/v2/* endpoints may expose draft posts, user meta, settings" },
  { label: "Arbitrary file upload", detail: "Target plugins/themes with file upload; check MIME bypass with polyglots" },
];

export default function WordPress() {
  const [projectId, setProjectId] = useState("");
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetUrl, setTargetUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ id: string; status: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

        const execRes = await fetch("/api/v1/executions?limit=50", { headers });
        const execs: Execution[] = execRes.ok ? await execRes.json() : [];
        if (!cancelled) {
          setExecutions(execs.filter((e) => e.kind === "wordfence"));
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function launchScan() {
    if (!targetUrl.trim()) return;
    if (!projectId) { showToast("No project loaded"); return; }
    setScanning(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const r = await fetch(`/api/v1/projects/${projectId}/wordfence/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ target_url: targetUrl.trim() }),
      });
      if (r.ok) {
        const result = await r.json();
        setScanResult({ id: result.id ?? result.execution_id ?? "?", status: result.status ?? "queued" });
        showToast("Wordfence scan launched");
        // Refresh execution list
        const execRes = await fetch("/api/v1/executions?limit=50", {
          headers: key ? { "X-Api-Key": key } : {},
        });
        const execs: Execution[] = execRes.ok ? await execRes.json() : [];
        setExecutions(execs.filter((e) => e.kind === "wordfence"));
      } else {
        const err = await r.json().catch(() => ({ message: r.statusText }));
        showToast(`Error: ${err?.message ?? r.statusText}`);
      }
    } catch {
      showToast("Launch failed — check API connection");
    } finally {
      setScanning(false);
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
          <Globe size={16} />
          <span>WordPress</span>
          <small>{executions.length} recent</small>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Main content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {/* Launch form */}
          <div
            style={{
              background: "var(--panel)", border: "1px solid var(--border)",
              borderRadius: 6, padding: 20, marginBottom: 24, maxWidth: 560,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Launch Wordfence Scan</div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                  Target WordPress URL
                </label>
                <input
                  style={{
                    width: "100%", background: "var(--panel-2)", border: "1px solid var(--border)",
                    color: "var(--text)", padding: "7px 10px", borderRadius: 4, fontSize: 13,
                    fontFamily: "JetBrains Mono, monospace", boxSizing: "border-box",
                  }}
                  placeholder="https://target.com"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") launchScan(); }}
                />
              </div>
              <button
                className="action-btn primary"
                style={{ padding: "7px 18px", fontSize: 13, whiteSpace: "nowrap" }}
                disabled={scanning || !targetUrl.trim()}
                onClick={launchScan}
              >
                {scanning ? "Launching…" : "Launch Wordfence scan"}
              </button>
            </div>

            {scanResult && (
              <div
                style={{
                  marginTop: 14, padding: "10px 14px", background: "var(--panel-2)",
                  border: "1px solid var(--border)", borderRadius: 4,
                  fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                }}
              >
                <span style={{ color: "var(--muted)" }}>Execution </span>
                <code style={{ color: "var(--accent)" }}>{scanResult.id.slice(0, 16)}</code>
                <span style={{ color: "var(--muted)" }}> — </span>
                <span style={{ color: STATUS_COLOR[scanResult.status] ?? "var(--muted)" }}>
                  {scanResult.status}
                </span>
              </div>
            )}
          </div>

          {/* Recent executions */}
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--muted)" }}>
            Recent Wordfence Executions
          </div>
          {loading ? (
            <div className="page-loading">Loading…</div>
          ) : executions.length === 0 ? (
            <div className="empty-state-block">
              <p>No Wordfence scans yet. Enter a target URL and launch a scan.</p>
            </div>
          ) : (
            <div className="data-table-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Started</th>
                    <th>Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((e) => (
                    <tr key={e.id} className="data-row">
                      <td><code className="mono-cell">{e.id.slice(0, 14)}…</code></td>
                      <td>
                        <span style={{ color: STATUS_COLOR[e.status] ?? "var(--muted)", fontWeight: 500, fontSize: 12 }}>
                          {e.status}
                        </span>
                      </td>
                      <td className="muted-cell">{e.risk_class ?? "—"}</td>
                      <td className="time-cell">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="time-cell">{e.finished_at ? new Date(e.finished_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick-tips sidebar */}
        <div
          style={{
            width: 280, flexShrink: 0, borderLeft: "1px solid var(--border)",
            background: "var(--panel)", overflowY: "auto", padding: "20px 18px",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            WP Attack Patterns
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            {WP_TIPS.map((tip) => (
              <li key={tip.label} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 14, lineHeight: 1.3, flexShrink: 0 }}>›</span>
                <div>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--info)", marginBottom: 2 }}>
                    {tip.label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{tip.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
