import { useEffect, useMemo, useState } from "react";
import {
  Activity, Bot, Camera, Check, ChevronRight, CirclePause, CirclePlay,
  ExternalLink, Eye, Globe2, KeyRound, RefreshCw, ShieldCheck, Terminal,
} from "lucide-react";
import { getApiKey } from "../../lib/api";

type Role = "attacker" | "victim";
type Redaction = "always" | "evidence-only" | "off";
type RoleState = { health: string; paused: boolean; auth?: { label?: string } | null; browser?: { url?: string } };
type BridgeState = {
  connected: boolean;
  policy: { mode: string; scope: string[]; redaction_mode: Redaction };
  roles: Record<Role, RoleState>;
  approvals: Array<{ id: string; role?: Role; action?: string }>;
  logs: Array<{ ts: string; event: string; role?: Role; action?: string; agent?: string }>;
};

const fallback: BridgeState = {
  connected: false,
  policy: { mode: "guided", scope: [], redaction_mode: "evidence-only" },
  roles: {
    attacker: { health: "offline", paused: true, auth: null },
    victim: { health: "offline", paused: true, auth: null },
  },
  approvals: [], logs: [],
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Api-Key": getApiKey(), ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function BrowserLane({ role, state, busy, onControl }: {
  role: Role; state: RoleState; busy: string; onControl: (command: string, role: Role) => void;
}) {
  const isAttacker = role === "attacker";
  const ready = state.health === "ready";
  return (
    <section className={`hunt-lane ${role}`}>
      <header className="hunt-lane-head">
        <div className="hunt-role-mark"><span>{isAttacker ? "A" : "V"}</span></div>
        <div>
          <p>{isAttacker ? "ATTACKER SESSION" : "VICTIM SESSION"}</p>
          <h2>{isAttacker ? "Lower-privileged identity" : "Authorized test identity"}</h2>
        </div>
        <span className={`hunt-health ${ready ? "ready" : "offline"}`}><i />{ready ? "Ready" : "Offline"}</span>
      </header>

      <div className="hunt-browser-frame">
        <div className="hunt-browser-bar">
          <span className="traffic-lights"><i /><i /><i /></span>
          <div className="hunt-address"><ShieldCheck size={12} />{state.browser?.url || "No page loaded"}</div>
          <RefreshCw size={13} />
        </div>
        <div className="hunt-browser-empty">
          <Globe2 size={34} />
          <strong>{ready ? "Browser is ready" : "Session is not running"}</strong>
          <span>{ready ? "Open the live session for sign-in or direct control." : "Start Browser Hunt from the terminal to bring this lane online."}</span>
        </div>
      </div>

      <div className="hunt-lane-actions">
        <button disabled={!!busy || !ready} onClick={() => onControl("auth-begin", role)}><KeyRound size={14} />Sign in</button>
        <button disabled={!!busy || !ready} onClick={() => onControl("auth-ready", role)}><Check size={14} />Save identity</button>
        <button disabled={!!busy || !ready} onClick={() => onControl("auth-restore", role)}><RefreshCw size={14} />Restore</button>
        <button disabled={!!busy || !ready} onClick={() => onControl(state.paused ? "resume" : "pause", role)}>
          {state.paused ? <CirclePlay size={14} /> : <CirclePause size={14} />}{state.paused ? "Give agent control" : "Take control"}
        </button>
        <button disabled={!ready} onClick={() => window.open(`http://127.0.0.1:${isAttacker ? 8083 : 8084}`, "_blank", "noopener")}>
          <ExternalLink size={14} />Open browser
        </button>
      </div>

      <footer className="hunt-lane-foot">
        <span><i className={state.paused ? "paused" : "agent"} />{state.paused ? "Human control" : "Agent control"}</span>
        <span>{state.auth?.label || "No saved identity"}</span>
      </footer>
    </section>
  );
}

export default function BrowserHunt() {
  const [data, setData] = useState<BridgeState>(fallback);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [goal, setGoal] = useState("");
  const [scope, setScope] = useState("");

  async function refresh() {
    try {
      const next = await api<BridgeState>("/api/v1/browser-hunt/status");
      setData({ ...next, connected: true });
    } catch { setData((current) => ({ ...current, connected: false })); }
  }
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 5000); return () => window.clearInterval(timer); }, []);

  async function control(command: string, role?: Role, value?: string) {
    setBusy(`${command}:${role ?? "shared"}`); setNotice("");
    try {
      const result = await api<{ message?: string; url?: string }>("/api/v1/browser-hunt/control", {
        method: "POST", body: JSON.stringify({ command, role, value }),
      });
      if (result.url) window.open(result.url, "_blank", "noopener");
      setNotice(result.message || "Updated"); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Bridge request failed"); }
    finally { setBusy(""); }
  }

  const events = useMemo(() => data.logs.slice(-8).reverse(), [data.logs]);
  return (
    <div className="browser-hunt-page">
      <div className="hunt-titlebar">
        <div><p>WORKSPACE / BROWSER HUNT</p><h1>Two identities. One controlled test.</h1></div>
        <div className="hunt-title-actions">
          <span className={`bridge-state ${data.connected ? "online" : "offline"}`}><i />{data.connected ? "Bridge online" : "Bridge offline"}</span>
          <button onClick={refresh} aria-label="Refresh bridge"><RefreshCw size={14} /></button>
        </div>
      </div>

      <div className="hunt-layout">
        <div className="hunt-stage">
          <div className="hunt-lanes">
            <BrowserLane role="attacker" state={data.roles.attacker} busy={busy} onControl={control} />
            <div className="hunt-link"><span>ISOLATED</span><ChevronRight size={15} /></div>
            <BrowserLane role="victim" state={data.roles.victim} busy={busy} onControl={control} />
          </div>

          <section className="hunt-activity">
            <header><div><Activity size={15} /><strong>Live activity</strong></div><span>{events.length} recent events</span></header>
            <div className="hunt-events">
              {events.length ? events.map((event, index) => (
                <div className="hunt-event" key={`${event.ts}-${index}`}>
                  <time>{new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                  <i className={event.role || "system"} />
                  <span>{event.event.replaceAll(".", " ")}</span>
                  <small>{event.role || event.agent || "broker"}</small>
                </div>
              )) : <div className="hunt-empty-log">Activity will appear here when the bridge is running.</div>}
            </div>
          </section>
        </div>

        <aside className="hunt-rail">
          <section>
            <label>CONTROL MODE</label>
            <div className="hunt-segmented">
              {["guided", "balanced", "autonomous"].map((mode) => <button className={data.policy.mode === mode ? "active" : ""} onClick={() => control("policy-mode", undefined, mode)} key={mode}>{mode}</button>)}
            </div>
            <p>Guided asks before every change. Balanced lets low-risk actions continue.</p>
          </section>

          <section>
            <label>AUTHORIZED SCOPE</label>
            <div className="hunt-scope"><Globe2 size={14} /><span>{data.policy.scope[0] || "No target allowed"}</span></div>
            <div className="hunt-scope-editor"><input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="example.com or *.example.com" /><button disabled={!scope} onClick={() => { control("scope-add", undefined, scope); setScope(""); }}>Add</button></div>
          </section>

          <section>
            <label>EVIDENCE REDACTION</label>
            <div className="hunt-redaction">
              {(["always", "evidence-only", "off"] as Redaction[]).map((mode) => (
                <button className={data.policy.redaction_mode === mode ? "active" : ""} onClick={() => control("redaction", undefined, mode)} key={mode}>
                  <span>{mode === "evidence-only" ? "Evidence only" : mode[0].toUpperCase() + mode.slice(1)}</span>{data.policy.redaction_mode === mode && <Check size={13} />}
                </button>
              ))}
            </div>
            {data.policy.redaction_mode === "off" && <p className="hunt-warning">Captured values may include account data. Broker keys are still never shown.</p>}
          </section>

          <section>
            <div className="hunt-section-line"><label>PENDING APPROVALS</label><span>{data.approvals.length}</span></div>
            {data.approvals.length ? data.approvals.map((item) => <button className="approval-row" key={item.id} onClick={() => control("approve", item.role, item.id)}><Eye size={14} /><span>{item.action || "Browser action"}</span><ChevronRight size={13} /></button>) : <div className="rail-empty">Nothing is waiting.</div>}
          </section>

          <section className="hunt-provider">
            <label>AGENT STEP</label>
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Describe one next step…" />
            <div><button disabled={!goal || !!busy} onClick={() => control("agent-claude", "attacker", goal)}><Bot size={14} />Claude</button><button disabled={!goal || !!busy} onClick={() => control("agent-ollama", "attacker", goal)}><Terminal size={14} />Ollama</button></div>
          </section>
          {notice && <div className="hunt-notice">{notice}</div>}
        </aside>
      </div>
    </div>
  );
}
