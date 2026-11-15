import { useEffect, useRef, useState } from "react";
import {
  Globe, Radar, ShieldAlert, ShieldCheck, Users, Puzzle, Lock, Unlock,
  Boxes, AlertTriangle, Play, ChevronRight, Loader2,
} from "lucide-react";
import { fetchProjects, fingerprintWordPress, getApiKey, type WordpressFingerprint } from "../../lib/api";

const LS_TARGET = "cbx.wp.target";
const LS_SRC = "cbx.wp.srcpath";

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 45%)`;
}
function initials(name: string | null, slug: string | null): string {
  const s = (name || slug || "?").trim();
  const parts = s.split(/[\s_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function WordPressProfile() {
  const [projectId, setProjectId] = useState("");
  const [target, setTarget] = useState(() => localStorage.getItem(LS_TARGET) ?? "");
  const [srcPath, setSrcPath] = useState(() => localStorage.getItem(LS_SRC) ?? "");
  const [fp, setFp] = useState<WordpressFingerprint | null>(null);
  const [probing, setProbing] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function flash(m: string) {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }

  useEffect(() => {
    fetchProjects().then((ps) => { if (ps.length) setProjectId(ps[0].id); }).catch(() => {});
  }, []);

  async function probe() {
    if (!target.trim() || !projectId) return;
    localStorage.setItem(LS_TARGET, target.trim());
    setProbing(true); setErr("");
    try {
      setFp(await fingerprintWordPress(projectId, target.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Probe failed");
      setFp(null);
    } finally {
      setProbing(false);
    }
  }

  async function launch(path: string, body: Record<string, unknown>, label: string) {
    const key = getApiKey();
    try {
      const r = await fetch(`/api/v1/projects/${projectId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { "X-Api-Key": key } : {}) },
        body: JSON.stringify(body),
      });
      if (!r.ok) { flash(`${label} failed — ${r.status}`); return; }
      const j = await r.json().catch(() => ({}));
      flash(`${label} launched${j.id || j.execution_id ? ` — ${String(j.id || j.execution_id).slice(0, 12)}…` : ""}`);
    } catch { flash(`${label} failed — network error`); }
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Globe size={16} />
          <span>WordPress Intel</span>
          {fp && <small>{fp.target}</small>}
        </div>
      </div>

      {/* Probe bar */}
      <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0, alignItems: "center" }}>
        <div className="filter-input-wrap" style={{ flex: 1, maxWidth: 480 }}>
          <Globe size={13} />
          <input placeholder="https://target.example.com" value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") probe(); }} />
        </div>
        <button className="action-btn primary" onClick={probe} disabled={probing || !target.trim() || !projectId}>
          {probing ? <Loader2 size={13} className="spin" /> : <Radar size={13} />} {probing ? "Probing…" : "Probe target"}
        </button>
        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
        <button className="action-btn" onClick={() => target.trim() && launch("wordfence/runs", { target_url: target.trim() }, "Wordfence")} disabled={!projectId}>
          <Play size={12} /> Wordfence
        </button>
        <button className="action-btn" onClick={() => target.trim() && launch("scans", { target: target.trim(), profile: "generic" }, "Nuclei")} disabled={!projectId}>
          <Play size={12} /> Nuclei
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {err && (
          <div style={{ margin: 16, padding: "10px 14px", border: "1px solid var(--bad)", borderRadius: 6, color: "var(--bad)", fontSize: 12, background: "rgba(255,80,80,0.06)" }}>
            {err}{err.includes("scope") && " — register this target as a project with an authorized engagement and in-scope rule first."}
          </div>
        )}

        {!fp && !err ? (
          <div className="empty-state-block" style={{ marginTop: 48 }}>
            <Radar size={40} style={{ color: "var(--muted)", opacity: 0.4, margin: "0 auto 14px", display: "block" }} />
            <p style={{ textAlign: "center" }}>Enter a target and <strong>Probe</strong> for a live, passive fingerprint —
              version, plugins (flagged against known advisories), enumerated users, REST surface, exposed
              endpoints, and security-header posture. No auth, GET-only, scope-gated.</p>
          </div>
        ) : fp ? (
          <WpReport fp={fp} srcPath={srcPath} setSrcPath={setSrcPath}
            onPhpAudit={() => launch("raptor-scan", { protocol: "php", target_path: srcPath.trim(), output_format: "jsonl" }, "PHP audit")} />
        ) : null}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 200, background: "var(--panel)", border: "1px solid var(--accent)", color: "var(--accent)", padding: "9px 16px", borderRadius: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{toast}</div>
      )}
    </div>
  );
}

function WpReport({ fp, srcPath, setSrcPath, onPhpAudit }: {
  fp: WordpressFingerprint; srcPath: string; setSrcPath: (s: string) => void; onPhpAudit: () => void;
}) {
  const vulnCount = fp.vulnerable_plugin_count ?? fp.plugins.filter((p) => p.known_advisories).length;
  const userEnum = Number(fp.exposed.user_enum_count ?? fp.users.length);

  return (
    <div style={{ padding: 16 }}>
      {/* Verdict hero */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", border: `1px solid ${fp.is_wordpress ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, marginBottom: 16, background: "var(--panel)" }}>
        <div style={{ width: 46, height: 46, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: fp.is_wordpress ? "rgba(228,242,34,0.12)" : "var(--bg)", flexShrink: 0 }}>
          <Globe size={24} style={{ color: fp.is_wordpress ? "var(--accent)" : "var(--muted)" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            {fp.is_wordpress ? "WordPress detected" : "WordPress not confirmed"}
            {fp.version && <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--accent)", marginLeft: 10 }}>v{fp.version}</span>}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace", marginTop: 3 }}>
            {fp.server && <>server: {fp.server} · </>}
            {fp.generator ? `generator: ${fp.generator}` : "no generator meta"}
            {fp.rest_enabled && <> · REST on ({fp.route_count} routes)</>}
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 18 }}>
        <Tile label="Plugins" value={fp.plugins.length} />
        <Tile label="Vulnerable" value={vulnCount} color={vulnCount ? "var(--bad)" : "var(--muted)"} icon={vulnCount ? <AlertTriangle size={11} /> : undefined} />
        <Tile label="Users enum" value={userEnum} color={userEnum ? "var(--warn)" : "var(--muted)"} />
        <Tile label="Themes" value={fp.themes.length} />
        <Tile label="REST routes" value={fp.route_count} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: 14 }}>
        {/* Exposed surface */}
        <Panel title="Exposed surface" icon={<Unlock size={13} />}>
          <ChipRow items={[
            { label: "xmlrpc.php", hot: !!fp.exposed.xmlrpc },
            { label: "readme.html", hot: !!fp.exposed.readme },
            { label: "wp-login.php", hot: !!fp.exposed.login },
            { label: "REST user-enum", hot: !!fp.exposed.rest_users },
          ]} />
        </Panel>

        {/* Security headers */}
        <Panel title="Security headers" icon={<ShieldCheck size={13} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {Object.entries(fp.security_headers).map(([h, v]) => (
              <div key={h} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                {v ? <ShieldCheck size={12} style={{ color: "var(--good)" }} /> : <ShieldAlert size={12} style={{ color: "var(--bad)" }} />}
                <span style={{ color: v ? "var(--text)" : "var(--muted)" }}>{h}</span>
                {!v && <span style={{ color: "var(--bad)", marginLeft: "auto" }}>missing</span>}
              </div>
            ))}
          </div>
        </Panel>

        {/* Plugins */}
        {fp.plugins.length > 0 && (
          <Panel title={`Plugins (${fp.plugins.length})`} icon={<Puzzle size={13} />} span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {fp.plugins.map((p) => (
                <div key={p.slug} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                  <code style={{ color: "var(--text)", flex: 1 }}>{p.slug}</code>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: p.version ? "var(--muted)" : "var(--border)", fontSize: 11 }}>{p.version || "—"}</span>
                  {p.known_advisories ? (
                    <span className="sev-badge" style={{ color: "var(--bad)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <AlertTriangle size={10} /> {p.known_advisories} advisor{p.known_advisories === 1 ? "y" : "ies"}
                    </span>
                  ) : <span style={{ color: "var(--muted)", fontSize: 10 }}>—</span>}
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Users */}
        {fp.users.length > 0 && (
          <Panel title={`Enumerated users (${fp.users.length})`} icon={<Users size={13} />} span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {fp.users.map((u) => (
                <div key={`${u.id}-${u.slug}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px 5px 5px", border: "1px solid var(--border)", borderRadius: 20, background: "var(--bg)" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: avatarColor(u.slug || String(u.id)), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>
                    {initials(u.name, u.slug)}
                  </div>
                  <div style={{ lineHeight: 1.2 }}>
                    <div style={{ fontSize: 12, color: "var(--text)" }}>{u.name || u.slug}</div>
                    <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>id:{u.id} · {u.slug}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* REST namespaces */}
        {fp.namespaces.length > 0 && (
          <Panel title="REST namespaces" icon={<Boxes size={13} />} span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {fp.namespaces.map((n) => <span key={n} className="type-badge">{n}</span>)}
            </div>
          </Panel>
        )}

        {/* Source audit */}
        <Panel title="Source audit (Raptor PHP)" icon={<Lock size={13} />} span>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="" placeholder="/path/to/plugin/source" value={srcPath}
              onChange={(e) => { setSrcPath(e.target.value); localStorage.setItem(LS_SRC, e.target.value); }}
              style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "6px 9px", borderRadius: 4, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", outline: "none" }} />
            <button className="action-btn primary" onClick={onPhpAudit} disabled={!srcPath.trim()}>
              <ChevronRight size={13} /> Audit source
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Tile({ label, value, color = "var(--text)", icon }: { label: string; value: number; color?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ background: "var(--panel)", padding: "9px 14px" }}>
      <div style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 5 }}>
        {icon}{value}
      </div>
    </div>
  );
}

function Panel({ title, icon, children, span }: { title: string; icon: React.ReactNode; children: React.ReactNode; span?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel)", gridColumn: span ? "1 / -1" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
        {icon}<span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)" }}>{title}</span>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function ChipRow({ items }: { items: { label: string; hot: boolean }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {items.map((it) => (
        <span key={it.label} style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 4, fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
          border: `1px solid ${it.hot ? "var(--warn)" : "var(--border)"}`,
          color: it.hot ? "var(--warn)" : "var(--muted)",
          background: it.hot ? "rgba(240,190,40,0.08)" : "transparent",
        }}>
          {it.hot ? <Unlock size={11} /> : <Lock size={11} />} {it.label}
        </span>
      ))}
    </div>
  );
}
