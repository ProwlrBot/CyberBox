import { useState } from "react";
import { useProfile } from "../../contexts/ProfileContext";
import { setApiKey, getApiKey } from "../../lib/api";

interface Props { onSelect: (id: string) => void }

const PROFILE_ACCENT: Record<string, string> = {
  "bug-bounty":                    "#e4f222",
  "web-application-testing":       "#60a5fa",
  "api-security":                  "#a78bfa",
  "mobile-security":               "#4ade80",
  "cloud-security":                "#38bdf8",
  "container-kubernetes-security": "#fb923c",
  "malware-analysis":              "#f87171",
  "digital-forensics":             "#94a3b8",
  "osint":                         "#fbbf24",
  "soc-incident-response":         "#34d399",
  "ctf":                           "#e879f9",
  "security-education":            "#a3e635",
  "red-team":                      "#f87171",
  "blue-team":                     "#60a5fa",
  "purple-team":                   "#a78bfa",
  "custom":                        "#8a93a0",
};

function ApiKeyConnect({ onConnected }: { onConnected: () => void }) {
  const [key, setKey] = useState(() => getApiKey());
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [autoMsg, setAutoMsg] = useState("");

  async function tryAutoDetect() {
    setStatus("testing");
    setAutoMsg("Detecting…");
    try {
      // Try the backend without a key first — if it returns a key hint for localhost requests
      const r = await fetch("/api/v1/admin/bootstrap-key", { method: "GET" });
      if (r.ok) {
        const { key: detected } = await r.json() as { key: string };
        if (detected) {
          setKey(detected);
          setApiKey(detected);
          setStatus("ok");
          setAutoMsg("Auto-detected from control plane");
          setTimeout(onConnected, 600);
          return;
        }
      }
    } catch { /* fall through */ }
    setStatus("idle");
    setAutoMsg("Auto-detect failed — paste your key below");
  }

  async function handleConnect() {
    if (!key.trim()) return;
    setStatus("testing");
    try {
      setApiKey(key.trim());
      const r = await fetch("/api/v1/profiles", { headers: { "X-Api-Key": key.trim() } });
      if (r.ok) {
        setStatus("ok");
        setTimeout(onConnected, 400);
      } else {
        setStatus("fail");
      }
    } catch {
      setStatus("fail");
    }
  }

  return (
    <div className="wizard-step">
      <div className="wizard-eyebrow">Step 2 of 3</div>
      <h1 className="wizard-title">Connect to control plane</h1>
      <p className="wizard-body">
        CyberBox needs your API key to load profiles and run hunts.
        Find it at <code style={{ color: "var(--accent)", fontSize: 11 }}>~/.cyberbox/admin.key</code> or run{" "}
        <code style={{ color: "var(--accent)", fontSize: 11 }}>! cat ~/.cyberbox/admin.key</code> in the terminal.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "20px 0" }}>
        <button
          className="wizard-secondary"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={tryAutoDetect}
          disabled={status === "testing"}
        >
          {status === "testing" && !key ? "Detecting…" : "⚡ Auto-detect key"}
        </button>
        {autoMsg && (
          <p style={{ margin: 0, fontSize: 11, color: status === "ok" ? "var(--good)" : "var(--muted)", textAlign: "center" }}>
            {autoMsg}
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--muted)", fontSize: 11 }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          or paste manually
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <label className="wizard-field">
          <span>API key</span>
          <input
            type="password"
            value={key}
            onChange={(e) => { setKey(e.target.value); setStatus("idle"); }}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="cbx-…"
            autoComplete="off"
          />
        </label>

        {status === "fail" && (
          <p style={{ margin: 0, fontSize: 11, color: "var(--bad)" }}>
            Invalid key — check ~/.cyberbox/admin.key and try again.
          </p>
        )}
        {status === "ok" && (
          <p style={{ margin: 0, fontSize: 11, color: "var(--good)" }}>Connected ✓</p>
        )}
      </div>

      <div className="wizard-actions">
        <button
          className="wizard-primary"
          disabled={!key.trim() || status === "testing" || status === "ok"}
          onClick={handleConnect}
        >
          {status === "testing" ? "Connecting…" : "Connect →"}
        </button>
      </div>
    </div>
  );
}

export function Step2ProfileSelect({ onSelect }: Props) {
  const { profiles, reloadProfiles } = useProfile();
  const [connecting, setConnecting] = useState(false);

  if (profiles.length === 0) {
    return (
      <ApiKeyConnect
        onConnected={async () => {
          setConnecting(true);
          await reloadProfiles();
          setConnecting(false);
        }}
      />
    );
  }

  if (connecting) {
    return (
      <div className="wizard-step">
        <div className="wizard-eyebrow">Step 2 of 3</div>
        <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>
          Loading profiles…
        </div>
      </div>
    );
  }

  return (
    <div className="wizard-step">
      <div className="wizard-eyebrow">Step 2 of 3</div>
      <h1 className="wizard-title">Choose a research profile</h1>
      <p className="wizard-body">
        Profiles set workspace mode, policy defaults, and recommended panels.
        You can switch at any time from Settings → Profile.
      </p>
      <div className="profile-card-grid">
        {profiles.map((p) => (
          <button
            key={p.id}
            className="profile-card"
            onClick={() => onSelect(p.id)}
            style={{ "--card-accent": PROFILE_ACCENT[p.id] ?? "#e4f222" } as React.CSSProperties}
          >
            <div className="profile-card-top">
              <strong className="profile-card-name">{p.name}</strong>
              <span className={`cb-maturity-pill ${p.maturity}`}>{p.maturity}</span>
            </div>
            <p className="profile-card-desc">{p.manifest?.description ?? ""}</p>
            <div className="profile-card-domains">
              {(p.manifest?.domains ?? []).slice(0, 3).map((d) => (
                <span key={d} className="profile-card-tag">{d}</span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
