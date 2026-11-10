import { useState, useEffect } from "react";
import { getApiKey, setApiKey } from "../../../lib/api";
import { useProfile } from "../../../contexts/ProfileContext";

export function ConnectionSection() {
  const { reloadProfiles, profiles } = useProfile();
  const [key, setKey] = useState(() => getApiKey());
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (getApiKey()) setStatus("ok");
  }, []);

  async function handleTest() {
    if (!key.trim()) return;
    setStatus("testing");
    setSaved(false);
    try {
      setApiKey(key.trim());
      const r = await fetch("/api/v1/profiles", { headers: { "X-Api-Key": key.trim() } });
      if (r.ok) {
        setStatus("ok");
        setSaved(true);
        await reloadProfiles();
        setTimeout(() => setSaved(false), 2000);
      } else {
        setStatus("fail");
      }
    } catch {
      setStatus("fail");
    }
  }

  async function handleAutoDetect() {
    setStatus("testing");
    try {
      const r = await fetch("/api/v1/admin/bootstrap-key");
      if (r.ok) {
        const { key: detected } = await r.json() as { key: string };
        if (detected) {
          setKey(detected);
          setApiKey(detected);
          setStatus("ok");
          setSaved(true);
          await reloadProfiles();
          setTimeout(() => setSaved(false), 2000);
          return;
        }
      }
    } catch { /* fall through */ }
    setStatus("idle");
  }

  function handleClear() {
    setKey("");
    setApiKey("");
    setStatus("idle");
  }

  const statusColor = status === "ok" ? "var(--good)" : status === "fail" ? "var(--bad)" : "var(--muted)";
  const statusText = status === "ok"
    ? `Connected — ${profiles.length} profile${profiles.length !== 1 ? "s" : ""} loaded`
    : status === "fail" ? "Invalid key — check ~/.cyberbox/admin.key"
    : status === "testing" ? "Testing…"
    : key ? "Key set but not tested" : "No key set";

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Control plane connection</h2>
      <p className="settings-section-desc">
        The API key authenticates all requests to the CyberBox control plane.
        Find your admin key at <code style={{ color: "var(--accent)", fontSize: 11 }}>~/.cyberbox/admin.key</code>.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: statusColor }}>{statusText}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--muted)" }}>
          API key
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              value={key}
              onChange={(e) => { setKey(e.target.value); setStatus("idle"); }}
              onKeyDown={(e) => e.key === "Enter" && handleTest()}
              placeholder="cbx-…"
              autoComplete="off"
              style={{
                flex: 1, height: 34, background: "var(--bg)", border: "1px solid var(--border)",
                color: "var(--text)", padding: "0 10px", borderRadius: 3,
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, outline: "none",
              }}
            />
            <button
              className="action-btn primary"
              onClick={handleTest}
              disabled={!key.trim() || status === "testing"}
              style={{ flexShrink: 0 }}
            >
              {saved ? "✓ Saved" : status === "testing" ? "Testing…" : "Save & test"}
            </button>
          </div>
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="action-btn" onClick={handleAutoDetect} disabled={status === "testing"}>
            ⚡ Auto-detect
          </button>
          {key && (
            <button className="action-btn" onClick={handleClear} style={{ color: "var(--bad)", borderColor: "var(--bad)" }}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 24, padding: "12px 14px", background: "var(--panel-2)", borderRadius: 4, border: "1px solid var(--border)", maxWidth: 480 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>How to find your key</div>
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.7 }}>
          Run in a terminal: <code style={{ color: "var(--accent)" }}>cat ~/.cyberbox/admin.key</code><br />
          Or: <code style={{ color: "var(--accent)" }}>! cat ~/.cyberbox/admin.key</code> from the Claude Code prompt
        </div>
      </div>
    </div>
  );
}
