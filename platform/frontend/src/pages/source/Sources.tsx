import { useEffect, useState, useCallback } from "react";
import {
  GitFork, AlertTriangle, Plus, X as XIcon, Crosshair, GitCommit, FileDiff, ShieldAlert,
} from "lucide-react";
import {
  fetchProjects, fetchSources, fetchSource, registerSource, setObservedRevision,
  addRevision, recordDiff, fetchRegressionCandidates,
  type Source, type RegressionCandidate,
} from "../../lib/api";

const KINDS = ["github", "gitlab", "vercel", "wordpress", "npm", "container"];

function shortRev(r: string | null | undefined): string {
  if (!r) return "—";
  return r.length > 12 ? r.slice(0, 12) : r;
}

export default function Sources() {
  const [projectId, setProjectId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [leads, setLeads] = useState<RegressionCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Source | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [toast, setToast] = useState("");

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3500); }

  const refresh = useCallback(async (pid: string) => {
    const [srcs, cands] = await Promise.all([
      fetchSources(pid),
      fetchRegressionCandidates({ projectId: pid }),
    ]);
    setSources(srcs);
    setLeads(cands);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchProjects().then(async (ps) => {
      if (cancelled || !ps.length) { setLoading(false); return; }
      const pid = ps[0].id;
      setProjectId(pid);
      await refresh(pid);
      if (!cancelled) setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  async function openSource(id: string) {
    setSelected(await fetchSource(id));
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <GitFork size={16} />
          <span>Sources</span>
          <small>silent-patch regression tracking</small>
        </div>
        <div className="toolbar-actions">
          {projectId && (
            <button className="action-btn primary" onClick={() => setShowRegister(true)}>
              <Plus size={13} /> Register source
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading sources…</div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {/* Regression leads — the payoff */}
          <div style={{
            border: `1px solid ${leads.length ? "var(--bad)" : "var(--border)"}`,
            borderRadius: 6, marginBottom: 20, overflow: "hidden",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "9px 14px",
              background: leads.length ? "rgba(255,80,80,0.08)" : "var(--panel)",
              borderBottom: "1px solid var(--border)",
            }}>
              <ShieldAlert size={15} style={{ color: leads.length ? "var(--bad)" : "var(--muted)" }} />
              <span style={{ fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)" }}>
                Regression leads
              </span>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, marginLeft: "auto",
                color: leads.length ? "var(--bad)" : "var(--muted)",
              }}>{leads.length}</span>
            </div>
            {leads.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--muted)" }}>
                No regression leads. A lead fires when a source's observed (deployed) revision is the
                pre-fix revision of a diff you've marked security-relevant — i.e. the target is still
                running vulnerable code.
              </div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {leads.map((l) => (
                  <li key={l.id} style={{ padding: "11px 14px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span className="type-badge">{l.kind}</span>
                      <code style={{ fontSize: 12, color: "var(--text)" }}>{l.identifier}</code>
                    </div>
                    <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "var(--muted)" }}>
                      deployed <code style={{ color: "var(--bad)" }}>{shortRev(l.observed_revision)}</code>
                      {" = pre-fix of "}
                      <code style={{ color: "var(--bad)" }}>{shortRev(l.from_revision)}</code>
                      {" → "}
                      <code style={{ color: "var(--good)" }}>{shortRev(l.to_revision)}</code>
                    </div>
                    {l.summary && <div style={{ fontSize: 12, color: "var(--text)", marginTop: 4 }}>{l.summary}</div>}
                    {l.files_changed?.length > 0 && (
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                        {l.files_changed.slice(0, 6).join(", ")}{l.files_changed.length > 6 ? ` +${l.files_changed.length - 6}` : ""}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Watched sources */}
          {sources.length === 0 ? (
            <div className="empty-state-block">
              <p>No sources watched yet. Register a target's repo, deploy, or plugin — then record its
                revisions and known security-fix diffs. Set the revision observed live on the target to
                anchor regression detection.</p>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Kind</th><th>Identifier</th><th>Label</th><th>Observed rev</th></tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id} className="data-row" style={{ cursor: "pointer" }} onClick={() => openSource(s.id)}>
                      <td><span className="type-badge">{s.kind}</span></td>
                      <td><code className="mono-cell" style={{ color: "var(--text)" }}>{s.identifier}</code></td>
                      <td className="muted-cell">{s.label || "—"}</td>
                      <td><code className="mono-cell">{shortRev(s.observed_revision)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showRegister && (
        <RegisterModal
          projectId={projectId}
          onClose={() => setShowRegister(false)}
          onDone={async () => { setShowRegister(false); await refresh(projectId); flash("Source registered"); }}
        />
      )}

      {selected && (
        <SourceDetail
          source={selected}
          onClose={() => setSelected(null)}
          onChange={async () => { setSelected(await fetchSource(selected.id)); await refresh(projectId); }}
          flash={flash}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 300, background: "var(--panel)",
          border: "1px solid var(--accent)", color: "var(--accent)", padding: "9px 16px",
          borderRadius: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        }}>{toast}</div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)",
  padding: "6px 9px", borderRadius: 4, fontSize: 12, outline: "none", width: "100%",
};

function RegisterModal({ projectId, onClose, onDone }: {
  projectId: string; onClose: () => void; onDone: () => void;
}) {
  const [kind, setKind] = useState("github");
  const [identifier, setIdentifier] = useState("");
  const [label, setLabel] = useState("");
  const [observed, setObserved] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr(""); setBusy(true);
    try {
      await registerSource({
        kind, identifier: identifier.trim(), project_id: projectId,
        label: label.trim() || null, observed_revision: observed.trim() || null,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Register failed");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: "min(520px, 100%)" }}>
        <div className="modal-header"><h2>Register source</h2><button onClick={onClose}><XIcon size={16} /></button></div>
        <div className="modal-field">
          <label>Kind</label>
          <select style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="modal-field">
          <label>Identifier</label>
          <input style={inputStyle} value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            placeholder="org/repo, deploy slug, plugin name…" />
        </div>
        <div className="modal-field">
          <label>Label (optional)</label>
          <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="human name" />
        </div>
        <div className="modal-field">
          <label>Observed revision (optional — what's live on target)</label>
          <input style={inputStyle} value={observed} onChange={(e) => setObserved(e.target.value)} placeholder="commit / deploy / version" />
        </div>
        {err && <div style={{ color: "var(--bad)", fontSize: 12 }}>{err}</div>}
        <div className="modal-actions">
          <button className="action-btn" onClick={onClose}>Cancel</button>
          <button className="action-btn primary" onClick={submit} disabled={busy || !identifier.trim()}>
            {busy ? "Saving…" : "Register"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceDetail({ source, onClose, onChange, flash }: {
  source: Source; onClose: () => void; onChange: () => void; flash: (m: string) => void;
}) {
  const [observed, setObserved] = useState(source.observed_revision || "");
  const [showRev, setShowRev] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  async function saveObserved() {
    try { await setObservedRevision(source.id, observed.trim()); flash("Observed revision set"); onChange(); }
    catch (e) { flash(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: "min(720px, 100%)", maxHeight: "88vh", overflowY: "auto" }}>
        <div className="modal-header">
          <h2><span className="type-badge" style={{ marginRight: 8 }}>{source.kind}</span>{source.identifier}</h2>
          <button onClick={onClose}><XIcon size={16} /></button>
        </div>

        <div className="modal-field">
          <label><Crosshair size={11} style={{ verticalAlign: "-1px" }} /> Observed revision (deployed on target)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={inputStyle} value={observed} onChange={(e) => setObserved(e.target.value)} placeholder="revision live on target" />
            <button className="action-btn primary" onClick={saveObserved} disabled={!observed.trim() || observed.trim() === source.observed_revision}>Set</button>
          </div>
        </div>

        {/* Revisions */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <GitCommit size={13} style={{ color: "var(--muted)" }} />
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
              Revisions ({source.revisions?.length ?? 0})
            </span>
            <button className="action-btn" style={{ marginLeft: "auto" }} onClick={() => setShowRev((v) => !v)}>
              <Plus size={12} /> Add
            </button>
          </div>
          {showRev && <AddRevisionForm sourceId={source.id} onDone={() => { setShowRev(false); onChange(); }} flash={flash} />}
          {(source.revisions ?? []).map((r) => (
            <div key={r.id} style={{ padding: "5px 0", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid var(--border)" }}>
              <code style={{ color: r.revision === source.observed_revision ? "var(--bad)" : "var(--text)" }}>{shortRev(r.revision)}</code>
              {r.ref && <span style={{ color: "var(--muted)" }}> · {r.ref}</span>}
              {r.revision === source.observed_revision && <span style={{ color: "var(--bad)" }}> · deployed</span>}
            </div>
          ))}
        </div>

        {/* Diffs */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <FileDiff size={13} style={{ color: "var(--muted)" }} />
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
              Diffs ({source.diffs?.length ?? 0})
            </span>
            <button className="action-btn" style={{ marginLeft: "auto" }} onClick={() => setShowDiff((v) => !v)}>
              <Plus size={12} /> Record
            </button>
          </div>
          {showDiff && <RecordDiffForm sourceId={source.id} onDone={() => { setShowDiff(false); onChange(); }} flash={flash} />}
          {(source.diffs ?? []).map((d) => {
            const isLead = d.security_relevant === 1 && d.from_revision === source.observed_revision;
            return (
              <div key={d.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                  <code>{shortRev(d.from_revision)}</code> → <code>{shortRev(d.to_revision)}</code>
                  {d.security_relevant === 1 && (
                    <span style={{ color: "var(--warn)", marginLeft: 8 }}>
                      <AlertTriangle size={10} style={{ verticalAlign: "-1px" }} /> security-relevant
                    </span>
                  )}
                  {isLead && <span style={{ color: "var(--bad)", marginLeft: 6, fontWeight: 700 }}>⚑ REGRESSION LEAD</span>}
                </div>
                {d.summary && <div style={{ fontSize: 12, color: "var(--text)", marginTop: 3 }}>{d.summary}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AddRevisionForm({ sourceId, onDone, flash }: { sourceId: string; onDone: () => void; flash: (m: string) => void }) {
  const [revision, setRevision] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try { await addRevision(sourceId, { revision: revision.trim(), ref: ref.trim() || null }); onDone(); }
    catch (e) { flash(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
      <input style={inputStyle} value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="revision (commit/version)" />
      <input style={{ ...inputStyle, maxWidth: 140 }} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ref (optional)" />
      <button className="action-btn primary" onClick={submit} disabled={busy || !revision.trim()}>Add</button>
    </div>
  );
}

function RecordDiffForm({ sourceId, onDone, flash }: { sourceId: string; onDone: () => void; flash: (m: string) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState("");
  const [files, setFiles] = useState("");
  const [sec, setSec] = useState(true);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await recordDiff(sourceId, {
        from_revision: from.trim(), to_revision: to.trim(),
        files_changed: files.split(",").map((f) => f.trim()).filter(Boolean),
        summary: summary.trim() || null, security_relevant: sec,
      });
      onDone();
    } catch (e) { flash(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, padding: 10, border: "1px solid var(--border)", borderRadius: 5 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="from revision (pre-fix)" />
        <input style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} placeholder="to revision (fixed)" />
      </div>
      <input style={inputStyle} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="what the fix changed" />
      <input style={inputStyle} value={files} onChange={(e) => setFiles(e.target.value)} placeholder="files changed (comma-separated)" />
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text)" }}>
        <input type="checkbox" checked={sec} onChange={(e) => setSec(e.target.checked)} /> security-relevant
      </label>
      <button className="action-btn primary" onClick={submit} disabled={busy || !from.trim() || !to.trim()}>Record diff</button>
    </div>
  );
}
