import { useEffect, useState } from "react";
import { FileDiff, Plus, Minus, KeyRound, Link2, RefreshCw, Camera, AlertTriangle } from "lucide-react";
import {
  fetchProjects, fetchJsTracked, snapshotJs, fetchJsDiff,
  type JsTracked, type JsDiff,
} from "../../lib/api";

const label: React.CSSProperties = {
  fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--muted)", marginBottom: 4,
};

function diffLineColor(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "var(--good)";
  if (line.startsWith("-") && !line.startsWith("---")) return "var(--bad)";
  if (line.startsWith("@@")) return "var(--info)";
  return "var(--muted)";
}

export default function JsDiff() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [tracked, setTracked] = useState<JsTracked[]>([]);
  const [urls, setUrls] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<JsDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    (async () => {
      const ps = await fetchProjects();
      setProjects(ps);
      if (ps.length) setProjectId((c) => c || ps[0].id);
    })();
  }, []);

  async function loadTracked(pid: string) {
    if (!pid) return;
    setTracked(await fetchJsTracked(pid));
  }
  useEffect(() => { void loadTracked(projectId); }, [projectId]);

  async function doSnapshot() {
    const list = urls.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    setBusy(true); setToast("");
    try {
      const r = await snapshotJs(projectId, list);
      setToast(`${r.changed} of ${r.snapshots.length} changed`);
      await loadTracked(projectId);
    } catch (e: any) {
      setToast(e.message || "snapshot failed");
    } finally { setBusy(false); }
  }

  async function openDiff(url: string) {
    setSelected(url); setDiff(null);
    setDiff(await fetchJsDiff(projectId, url));
  }

  return (
    <div style={{ padding: 20, maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <FileDiff size={20} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 18, margin: 0 }}>JS Diff</h1>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>snapshot JS bundles · hunt new endpoints &amp; secrets on each deploy</span>
        <div style={{ flex: 1 }} />
        <select className="action-btn" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="action-btn" onClick={() => loadTracked(projectId)} title="Refresh"><RefreshCw size={13} /></button>
      </div>

      {/* Snapshot input */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={urls} onChange={(e) => setUrls(e.target.value)}
          placeholder="https://target/assets/app.js  (space/comma separated; must be in scope)"
          style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6,
                   padding: "8px 12px", color: "var(--text)", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
        />
        <button className="action-btn" disabled={busy} onClick={doSnapshot} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Camera size={13} /> {busy ? "fetching…" : "Snapshot"}
        </button>
      </div>
      {toast && <div style={{ fontSize: 11, color: "var(--info)", marginBottom: 12 }}>{toast}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16 }}>
        {/* Tracked list */}
        <div>
          <div style={label}>Tracked bundles ({tracked.length})</div>
          {tracked.length === 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>Snapshot a JS URL to start tracking it. Re-snapshot after a deploy to diff.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tracked.map((t) => (
              <button key={t.url} onClick={() => openDiff(t.url)}
                style={{ textAlign: "left", background: selected === t.url ? "var(--panel)" : "transparent",
                         border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", cursor: "pointer", color: "var(--text)" }}>
                <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", wordBreak: "break-all", marginBottom: 4 }}>{t.url}</div>
                <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--muted)" }}>
                  <span>{t.revisions} rev{t.revisions === 1 ? "" : "s"}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Link2 size={9} />{t.endpoint_count}</span>
                  {t.secret_count > 0 && <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--bad)" }}><KeyRound size={9} />{t.secret_count}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Diff pane */}
        <div>
          {!selected && <div style={{ fontSize: 12, color: "var(--muted)" }}>Select a bundle with ≥2 revisions to see what a deploy changed.</div>}
          {selected && !diff && <div style={{ fontSize: 12, color: "var(--muted)" }}>No diff — the bundle needs at least two distinct revisions. Re-snapshot after a deploy.</div>}
          {diff && (
            <div>
              {diff.added_endpoints.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ ...label, color: "var(--good)" }}><Plus size={10} style={{ verticalAlign: "middle" }} /> New endpoints ({diff.added_endpoints.length})</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {diff.added_endpoints.map((e) => (
                      <code key={e} style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(44,224,126,0.1)", border: "1px solid var(--good)", color: "var(--text)" }}>{e}</code>
                    ))}
                  </div>
                </div>
              )}
              {diff.added_secrets.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ ...label, color: "var(--bad)" }}><AlertTriangle size={10} style={{ verticalAlign: "middle" }} /> New secret leads ({diff.added_secrets.length}) — verify, do not assume live</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {diff.added_secrets.map((s, i) => (
                      <div key={i} style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                        <span style={{ color: "var(--bad)" }}>{s.kind}</span>{"  "}<span style={{ color: "var(--muted)" }}>{s.match}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {diff.removed_endpoints.length > 0 && (
                <div style={{ marginBottom: 12, fontSize: 10, color: "var(--muted)" }}>
                  <Minus size={10} style={{ verticalAlign: "middle" }} /> removed: {diff.removed_endpoints.join(", ")}
                </div>
              )}
              <div style={label}>Unified diff {diff.from.hash} → {diff.to.hash} {diff.unified_diff_truncated && <span style={{ color: "var(--warn)" }}>(truncated)</span>}</div>
              <pre style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: 12,
                            overflow: "auto", maxHeight: 520, fontSize: 11, lineHeight: 1.5, margin: 0 }}>
                {diff.unified_diff.map((ln, i) => (
                  <div key={i} style={{ color: diffLineColor(ln), whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{ln || " "}</div>
                ))}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
