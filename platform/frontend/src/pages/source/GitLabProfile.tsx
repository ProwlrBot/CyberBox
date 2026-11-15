import { useEffect, useRef, useState } from "react";
import {
  GitBranch, Radar, ShieldCheck, ShieldAlert, Unlock, Lock, FolderGit2,
  UserPlus, Boxes, Star, Play, Loader2, Server,
} from "lucide-react";
import { fetchProjects, fingerprintGitLab, getApiKey, type GitlabFingerprint } from "../../lib/api";

const LS_TARGET = "cbx.gl.target";
const LS_SRC = "cbx.gl.srcpath";

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const d = Math.floor((Date.now() - then) / 86400000);
  if (d === 0) return "today";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export default function GitLabProfile() {
  const [projectId, setProjectId] = useState("");
  const [target, setTarget] = useState(() => localStorage.getItem(LS_TARGET) ?? "https://gitlab.com");
  const [srcPath, setSrcPath] = useState(() => localStorage.getItem(LS_SRC) ?? "");
  const [fp, setFp] = useState<GitlabFingerprint | null>(null);
  const [probing, setProbing] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function flash(m: string) {
    setToast(m); clearTimeout(toastTimer.current);
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
      setFp(await fingerprintGitLab(projectId, target.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Probe failed");
      setFp(null);
    } finally { setProbing(false); }
  }

  async function phpAudit() {
    const key = getApiKey();
    try {
      const r = await fetch(`/api/v1/projects/${projectId}/raptor-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { "X-Api-Key": key } : {}) },
        body: JSON.stringify({ protocol: "gitlab", target_path: srcPath.trim(), output_format: "jsonl" }),
      });
      if (!r.ok) { flash(`Source audit failed — ${r.status}`); return; }
      const j = await r.json().catch(() => ({}));
      flash(`Source audit launched${j.execution_id ? ` — ${String(j.execution_id).slice(0, 12)}…` : ""}`);
    } catch { flash("Source audit failed — network error"); }
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <GitBranch size={16} />
          <span>GitLab Intel</span>
          {fp && <small>{fp.target}</small>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0, alignItems: "center" }}>
        <div className="filter-input-wrap" style={{ flex: 1, maxWidth: 480 }}>
          <GitBranch size={13} />
          <input placeholder="https://gitlab.target.com" value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") probe(); }} />
        </div>
        <button className="action-btn primary" onClick={probe} disabled={probing || !target.trim() || !projectId}>
          {probing ? <Loader2 size={13} className="spin" /> : <Radar size={13} />} {probing ? "Probing…" : "Probe target"}
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
            <p style={{ textAlign: "center" }}>Enter a GitLab target and <strong>Probe</strong> for a live, passive fingerprint —
              version, open sign-up, public API &amp; projects, GraphQL exposure, and security-header posture.
              No auth, GET-only, scope-gated.</p>
          </div>
        ) : fp ? (
          <GlReport fp={fp} relTime={relTime} srcPath={srcPath}
            setSrcPath={(s) => { setSrcPath(s); localStorage.setItem(LS_SRC, s); }} onPhpAudit={phpAudit} />
        ) : null}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 200, background: "var(--panel)", border: "1px solid var(--accent)", color: "var(--accent)", padding: "9px 16px", borderRadius: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{toast}</div>
      )}
    </div>
  );
}

function GlReport({ fp, relTime, srcPath, setSrcPath, onPhpAudit }: {
  fp: GitlabFingerprint; relTime: (s: string | null) => string;
  srcPath: string; setSrcPath: (s: string) => void; onPhpAudit: () => void;
}) {
  return (
    <div style={{ padding: 16 }}>
      {/* Verdict hero */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", border: `1px solid ${fp.is_gitlab ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, marginBottom: 16, background: "var(--panel)" }}>
        <div style={{ width: 46, height: 46, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: fp.is_gitlab ? "rgba(228,242,34,0.12)" : "var(--bg)", flexShrink: 0 }}>
          <GitBranch size={24} style={{ color: fp.is_gitlab ? "var(--accent)" : "var(--muted)" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
            {fp.is_gitlab ? "GitLab detected" : "GitLab not confirmed"}
            {fp.version && <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--accent)", marginLeft: 10 }}>v{fp.version}</span>}
            {fp.enterprise != null && <span className="type-badge" style={{ marginLeft: 10 }}>{fp.enterprise ? "EE" : "CE"}</span>}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace", marginTop: 3 }}>
            {fp.server && <><Server size={10} style={{ verticalAlign: "-1px" }} /> {fp.server} · </>}
            {fp.revision ? `rev ${fp.revision.slice(0, 10)}` : "revision hidden"}
            {fp.api_reachable && <> · API reachable</>}
          </div>
        </div>
        {fp.signup_enabled && (
          <span className="sev-badge" style={{ color: "var(--warn)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <UserPlus size={12} /> open sign-up
          </span>
        )}
      </div>

      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px,1fr))", gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 18 }}>
        <Tile label="Public projects" value={fp.public_project_count} color={fp.public_project_count ? "var(--info)" : "var(--muted)"} />
        <Tile label="Open sign-up" value={fp.signup_enabled ? "YES" : "no"} color={fp.signup_enabled ? "var(--warn)" : "var(--muted)"} />
        <Tile label="Public API" value={fp.api_reachable ? "YES" : "no"} color={fp.api_reachable ? "var(--info)" : "var(--muted)"} />
        <Tile label="GraphQL" value={fp.exposed.graphql ? "exposed" : "no"} color={fp.exposed.graphql ? "var(--warn)" : "var(--muted)"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: 14 }}>
        {/* Exposed surface */}
        <Panel title="Exposed surface" icon={<Unlock size={13} />}>
          <ChipRow items={[
            { label: "open sign-up", hot: !!fp.exposed.open_signup },
            { label: "public API (v4)", hot: !!fp.exposed.public_api },
            { label: "public projects", hot: !!fp.exposed.public_projects },
            { label: "/explore", hot: !!fp.exposed.explore },
            { label: "/api/graphql", hot: !!fp.exposed.graphql },
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

        {/* Public projects */}
        {fp.public_projects.length > 0 && (
          <Panel title={`Public projects (${fp.public_project_count})`} icon={<FolderGit2 size={13} />} span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {fp.public_projects.map((p) => (
                <div key={p.path} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                  <FolderGit2 size={13} style={{ color: "var(--muted)" }} />
                  <code style={{ color: "var(--text)", flex: 1 }}>{p.path}</code>
                  {p.star_count != null && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--muted)", fontSize: 11 }}>
                      <Star size={11} /> {p.star_count}
                    </span>
                  )}
                  <span style={{ color: "var(--muted)", fontSize: 10, minWidth: 60, textAlign: "right" }}>{relTime(p.last_activity_at)}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Source audit */}
        <Panel title="Source audit (Raptor)" icon={<Boxes size={13} />} span>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="/path/to/cloned/repo" value={srcPath}
              onChange={(e) => setSrcPath(e.target.value)}
              style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "6px 9px", borderRadius: 4, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", outline: "none" }} />
            <button className="action-btn primary" onClick={onPhpAudit} disabled={!srcPath.trim()}>
              <Play size={13} /> Audit source
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Tile({ label, value, color = "var(--text)" }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ background: "var(--panel)", padding: "9px 14px" }}>
      <div style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: value === "YES" || value === "no" || value === "exposed" ? 15 : 22, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{value}</div>
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
