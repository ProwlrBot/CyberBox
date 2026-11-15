import { useCallback, useEffect, useState } from "react";
import { getApiKey } from "../../../lib/api";
import { Webhook, KeyRound, Plug, Bell, Trash2, Send } from "lucide-react";

type Channel = {
  id: string; kind: string; name: string; url_env: string | null;
  secret_env: string | null; enabled: number;
  url_configured?: boolean; config?: { topic?: string; min_severity?: string };
};

function headers(json = false): Record<string, string> {
  const key = getApiKey();
  const h: Record<string, string> = key ? { "X-Api-Key": key } : {};
  if (json) h["Content-Type"] = "application/json";
  return h;
}

type SubTab = "tokens" | "webhooks" | "mcp";

export function ApiSection() {
  const [tab, setTab] = useState<SubTab>("tokens");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [kind, setKind] = useState("discord");
  const [name, setName] = useState("");
  const [urlEnv, setUrlEnv] = useState("");
  const [topic, setTopic] = useState("cyberbox");
  const [testResult, setTestResult] = useState<string>("");
  const base = window.location.origin;

  const loadChannels = useCallback(async () => {
    const r = await fetch("/api/v1/notifications/channels", { headers: headers() });
    if (r.ok) setChannels(await r.json());
  }, []);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  async function addChannel() {
    if (!name.trim()) return;
    const config: Record<string, unknown> = {};
    if (kind === "ntfy") config.topic = topic;
    await fetch("/api/v1/notifications/channels", {
      method: "POST", headers: headers(true),
      body: JSON.stringify({ kind, name: name.trim(), url_env: urlEnv.trim() || null, config }),
    });
    setName(""); setUrlEnv("");
    loadChannels();
  }

  async function removeChannel(id: string) {
    await fetch(`/api/v1/notifications/channels/${id}`, { method: "DELETE", headers: headers() });
    loadChannels();
  }

  async function testChannels() {
    setTestResult("sending…");
    const r = await fetch("/api/v1/notifications/test", {
      method: "POST", headers: headers(true), body: JSON.stringify({}),
    });
    const d = await r.json();
    const sent = (d.results || []).filter((x: { status: string }) => x.status === "sent").length;
    const skipped = (d.results || []).filter((x: { status: string }) => x.status === "skipped").length;
    setTestResult(`${sent} sent · ${skipped} skipped · ${(d.results || []).length} channel(s)`);
  }

  return (
    <div className="cbx-page" style={{ padding: 0, maxWidth: "none" }}>
      <div className="cbx-eyebrow">Settings / API access</div>
      <h1 className="cbx-h1" style={{ fontSize: 20 }}>API, Webhooks & MCP</h1>
      <p className="cbx-sub">Call CyberBox from CI or scripts, receive GitHub events, and route alerts.</p>

      <div style={{ display: "flex", gap: 6, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {([["tokens", "Tokens", KeyRound], ["webhooks", "Webhooks", Webhook], ["mcp", "MCP", Plug]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
              borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === id ? "var(--text)" : "var(--muted)", padding: "8px 12px", cursor: "pointer",
              fontSize: 13, fontWeight: 500, marginBottom: -1 }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === "tokens" && (
        <div className="cbx-panel">
          <div className="cbx-panel-title">API key (x-api-key)</div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
            Your admin key authenticates every API call and MCP client. It lives at{" "}
            <span className="cbx-mono">~/.cyberbox/admin.key</span> and is set in the Connection tab.
          </p>
          <div className="cbx-mono" style={{ fontSize: 12, marginTop: 10, padding: "9px 11px",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 7 }}>
            {getApiKey() ? `${getApiKey().slice(0, 8)}${"•".repeat(16)}` : "— not set (see Connection)"}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 14 }}>
            <b style={{ color: "var(--text)" }}>Use in CI:</b>{" "}
            <span className="cbx-mono">curl -H "x-api-key: $CYBERBOX_KEY" {base}/api/v1/github/scans</span>
          </div>
        </div>
      )}

      {tab === "webhooks" && (
        <>
          <div className="cbx-panel" style={{ marginBottom: 16 }}>
            <div className="cbx-panel-title">GitHub webhook</div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
              Point a repo webhook (pull_request events) here. The secret is read from{" "}
              <span className="cbx-mono">$GITHUB_WEBHOOK_SECRET</span> — never stored.
            </p>
            <div className="cbx-mono" style={{ fontSize: 12, padding: "9px 11px", background: "var(--bg)",
              border: "1px solid var(--border)", borderRadius: 7, marginTop: 8 }}>
              POST {base}/api/v1/github/webhook
            </div>
          </div>

          <div className="cbx-panel">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div className="cbx-panel-title" style={{ margin: 0 }}><Bell size={11} style={{ verticalAlign: "-1px" }} /> Notification channels</div>
              <button className="cbx-btn cbx-btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={testChannels}>
                <Send size={12} /> Test all
              </button>
            </div>
            {testResult && <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 10 }}>{testResult}</div>}

            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 16 }}>
              {channels.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No channels yet.</div>}
              {channels.map((c) => (
                <div key={c.id} className="cbx-row" style={{ cursor: "default" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="cbx-sev low">{c.kind}</span>
                    <span style={{ fontSize: 13 }}>{c.name}</span>
                    {c.url_env && (
                      <span className="cbx-mono" style={{ fontSize: 11, color: c.url_configured ? "var(--good)" : "var(--warn)" }}>
                        ${c.url_env} {c.url_configured ? "✓" : "(unset)"}
                      </span>
                    )}
                  </span>
                  <button className="cbx-btn cbx-btn-ghost" style={{ padding: "4px 9px" }} onClick={() => removeChannel(c.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <label className="cbx-field">Channel<select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="discord">Discord</option><option value="ntfy">ntfy</option>
                <option value="webhook">Webhook</option><option value="jsonl">JSONL file</option>
              </select></label>
              <label className="cbx-field" style={{ flex: "1 1 120px" }}>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="team-alerts" /></label>
              {kind !== "jsonl" && (
                <label className="cbx-field" style={{ flex: "1 1 160px" }}>URL env var
                  <input value={urlEnv} onChange={(e) => setUrlEnv(e.target.value)} placeholder="CYBERBOX_DISCORD_WEBHOOK" />
                </label>
              )}
              {kind === "ntfy" && (
                <label className="cbx-field">Topic<input value={topic} onChange={(e) => setTopic(e.target.value)} style={{ width: 120 }} /></label>
              )}
              <button className="cbx-btn cbx-btn-primary" onClick={addChannel} disabled={!name.trim()}>Add channel</button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10 }}>
              The scan gate and scheduler drift alerts fire through enabled channels. Webhook URLs/secrets
              are read from the named env var (same model as cve-intel's <span className="cbx-mono">CVE_INTEL_*</span> secrets).
            </div>
          </div>
        </>
      )}

      {tab === "mcp" && (
        <div className="cbx-panel">
          <div className="cbx-panel-title">MCP — model context protocol</div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0, lineHeight: 1.55 }}>
            CyberBox exposes its captured traffic and actions through the <span className="cbx-mono">gori</span> MCP
            server, so an AI assistant (Claude, etc.) can drive proxy history, repeaters, fuzzing and issues directly.
            Point your MCP client at the gori server registered to this workspace.
          </p>
          <div className="cbx-mono" style={{ fontSize: 12, padding: "9px 11px", background: "var(--bg)",
            border: "1px solid var(--border)", borderRadius: 7, marginTop: 8 }}>
            gori mcp · bound to this project
          </div>
        </div>
      )}
    </div>
  );
}
