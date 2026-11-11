import { useEffect, useState } from "react";
import { Wrench, RefreshCw, Play, Lock, Bot, Hand, CircleDot, X as XIcon } from "lucide-react";
import { fetchProjects, fetchToolSpecs, runTool, type ToolSpec } from "../../lib/api";

// Operator palette over the unified ToolSpec registry — every registered tool, its tier/modes,
// and (for manual-capable executables) a click-to-run form that POSTs the generic run route.

const TIER_COLOR: Record<string, string> = {
  passive: "var(--good)", active: "var(--warn)", exploit: "var(--bad)",
};

// Per-tool single-field input → args. Fallback: a raw JSON field for anything unlisted.
type ArgShape = { label: string; placeholder: string; toArgs: (v: string) => Record<string, unknown> };
const csv = (v: string) => v.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
const ARGS: Record<string, ArgShape> = {
  vulnx:     { label: "Products / tech", placeholder: "grafana, confluence, wordpress", toArgs: (v) => ({ techs: csv(v), limit: 5 }) },
  gowitness: { label: "URLs", placeholder: "https://app.target.com  https://admin.target.com", toArgs: (v) => ({ urls: csv(v) }) },
  subfinder: { label: "Domain", placeholder: "target.com", toArgs: (v) => ({ target_url: v.trim() }) },
  httpx:     { label: "Target URL", placeholder: "https://target.com", toArgs: (v) => ({ target_url: v.trim() }) },
  nuclei:    { label: "Target URL", placeholder: "https://target.com", toArgs: (v) => ({ target_url: v.trim() }) },
  ffuf:      { label: "Target URL", placeholder: "https://target.com", toArgs: (v) => ({ target_url: v.trim() }) },
};

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.6, color,
                   border: `1px solid ${color}`, borderRadius: 4, padding: "1px 5px",
                   fontFamily: "'JetBrains Mono', monospace" }}>{children}</span>
  );
}

function RunForm({ projectId, tool, onClose }: { projectId: string; tool: ToolSpec; onClose: () => void }) {
  const shape = ARGS[tool.name];
  const [val, setVal] = useState("");
  const [raw, setRaw] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  async function go() {
    setBusy(true); setErr(""); setResult(null);
    try {
      const args = shape ? shape.toArgs(val) : JSON.parse(raw);
      const r = await runTool(projectId, tool.name, args);
      setResult(r);
    } catch (e: any) {
      setErr(e?.message || "run failed");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      {shape ? (
        <div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>{shape.label}</div>
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder={shape.placeholder}
                 style={inputStyle} />
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>args (JSON)</div>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <button className="action-btn" disabled={busy} onClick={go}
                style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Play size={12} /> {busy ? "running…" : "Run"}
        </button>
        <button className="action-btn" onClick={onClose}><XIcon size={12} /></button>
        {tool.danger_tier !== "passive" && (
          <span style={{ fontSize: 10, color: "var(--muted)" }}>operator-approved live action</span>
        )}
      </div>
      {err && <div style={{ fontSize: 11, color: "var(--bad)", marginTop: 8 }}>{err}</div>}
      {result && (
        <pre style={{ marginTop: 8, fontSize: 10.5, background: "var(--bg)", border: "1px solid var(--border)",
                      borderRadius: 5, padding: 8, overflow: "auto", maxHeight: 220,
                      color: result.status === "done" ? "var(--good)" : "var(--warn)" }}>
{`status: ${result.status}\n`}{JSON.stringify(result.output ?? {}, null, 2)}{result.error ? `\nerror: ${result.error}` : ""}
        </pre>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 5,
  padding: "7px 10px", color: "var(--text)", fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
};

export default function ToolPalette() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [specs, setSpecs] = useState<ToolSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTool, setOpenTool] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [ps, ss] = await Promise.all([fetchProjects(), fetchToolSpecs()]);
    setProjects(ps);
    setProjectId((c) => c || ps[0]?.id || "");
    setSpecs(ss);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  return (
    <div style={{ padding: 20, maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <Wrench size={20} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 18, margin: 0 }}>Tool Palette</h1>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          every registered tool · run manually through the same gate the AI uses
        </span>
        <div style={{ flex: 1 }} />
        {projects.length > 1 && (
          <select className="action-btn" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button className="action-btn" onClick={load} title="Refresh"><RefreshCw size={13} /></button>
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 12 }}>Loading tools…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
          {specs.map((t) => {
            const runnable = t.executable && t.modes.includes("manual");
            return (
              <div key={t.name} style={{ border: "1px solid var(--border)", borderRadius: 8,
                                         background: "var(--panel)", padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CircleDot size={11} style={{ color: t.available ? "var(--good)" : "var(--muted)" }} />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13 }}>{t.name}</span>
                  <div style={{ flex: 1 }} />
                  <Badge color={TIER_COLOR[t.danger_tier]}>{t.danger_tier}</Badge>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{t.category}</span>
                  {t.modes.includes("manual") && <Badge color="var(--info)"><Hand size={8} style={{ verticalAlign: -1 }} /> manual</Badge>}
                  {t.modes.includes("ai") && <Badge color="var(--accent)"><Bot size={8} style={{ verticalAlign: -1 }} /> ai</Badge>}
                  <Badge color="var(--muted)">{t.scope_required ? <><Lock size={8} style={{ verticalAlign: -1 }} /> scoped</> : "intel"}</Badge>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, lineHeight: 1.45 }}>{t.description}</div>
                <div style={{ marginTop: 10 }}>
                  {runnable ? (
                    openTool === t.name ? (
                      <RunForm projectId={projectId} tool={t} onClose={() => setOpenTool(null)} />
                    ) : (
                      <button className="action-btn" disabled={!t.available || !projectId}
                              onClick={() => setOpenTool(t.name)}
                              style={{ display: "flex", alignItems: "center", gap: 6 }}
                              title={!t.available ? "not installed on this host" : !projectId ? "no project" : ""}>
                        <Play size={12} /> Run
                      </button>
                    )
                  ) : (
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>
                      {t.executable ? "AI-only" : "catalog-only — use its dedicated page"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
