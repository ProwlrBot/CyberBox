import { useEffect, useState } from "react";
import { CheckCircle2, Cpu, X as XIcon, Plus, Play, Trash2, Clock } from "lucide-react";
import {
  fetchPendingApprovals, getApiKey, fetchProjects,
  fetchScheduledJobs, createScheduledJob, setScheduledJobEnabled, deleteScheduledJob, runDueJobs,
  type ScheduledJob,
} from "../../lib/api";

type Approval = { id: string; execution_id: string; action_class: string; status: string; expires_at: string };

const KINDS = [
  { value: "cve_intel_hunt", label: "CVE Intel Hunt" },
  { value: "github_scan",    label: "GitHub Scan" },
  { value: "surface_rescan", label: "Surface Rescan" },
];
const INTERVALS = [
  { value: 3600,  label: "Hourly" },
  { value: 21600, label: "Every 6h" },
  { value: 43200, label: "Every 12h" },
  { value: 86400, label: "Daily" },
];

function intervalLabel(s: number): string {
  if (s % 86400 === 0) return `${s / 86400}d`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(d);
  const unit = abs < 3600000 ? `${Math.round(abs / 60000)}m` : abs < 86400000 ? `${Math.round(abs / 3600000)}h` : `${Math.round(abs / 86400000)}d`;
  return d >= 0 ? `in ${unit}` : `${unit} ago`;
}

export default function Jobs() {
  const [tab, setTab] = useState<"scheduled" | "approvals">("scheduled");
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState("");

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  async function loadJobs() { setJobs(await fetchScheduledJobs()); }

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchScheduledJobs(), fetchPendingApprovals()])
      .then(([j, a]) => { if (!cancelled) { setJobs(j); setApprovals(a); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function decide(id: string, decision: "approved" | "denied") {
    const key = getApiKey();
    await fetch(`/api/v1/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Api-Key": key } : {}) },
      body: JSON.stringify({ status: decision }),
    });
    setApprovals((prev) => prev.filter((a) => a.id !== id));
  }

  async function toggle(job: ScheduledJob) {
    await setScheduledJobEnabled(job.id, !job.enabled);
    setJobs((prev) => prev.map((j) => j.id === job.id ? { ...j, enabled: job.enabled ? 0 : 1 } : j));
  }

  async function remove(job: ScheduledJob) {
    await deleteScheduledJob(job.id);
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await runDueJobs();
      flash(`Ran ${res.ran} due job${res.ran === 1 ? "" : "s"}`);
      await loadJobs();
    } finally { setRunning(false); }
  }

  const tabStyle = (t: "scheduled" | "approvals") => ({
    padding: "10px 16px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
    cursor: "pointer", background: "none", border: "none",
    borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
    color: tab === t ? "var(--text)" : "var(--muted)",
  } as React.CSSProperties);

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Cpu size={16} />
          <span>Jobs</span>
          <small>{jobs.length} scheduled · {approvals.length} pending</small>
        </div>
        {tab === "scheduled" && (
          <div className="toolbar-actions">
            <button className="action-btn" onClick={runNow} disabled={running}>
              <Play size={13} /> {running ? "Running…" : "Run due now"}
            </button>
            <button className="action-btn primary" onClick={() => setShowNew(true)}>
              <Plus size={13} /> New job
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0 }}>
        <button style={tabStyle("scheduled")} onClick={() => setTab("scheduled")}>Scheduled ({jobs.length})</button>
        <button style={tabStyle("approvals")} onClick={() => setTab("approvals")}>Approvals ({approvals.length})</button>
      </div>

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : tab === "scheduled" ? (
        jobs.length === 0 ? (
          <div className="empty-state-block">
            <p>No scheduled jobs. Create a recurring CVE-intel hunt, GitHub scan, or surface rescan.</p>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Kind</th><th>Spec</th><th>Interval</th><th>Next run</th><th>Last</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="data-row" style={{ opacity: j.enabled ? 1 : 0.5 }}>
                    <td><span className="type-badge">{j.kind}</span></td>
                    <td><code className="mono-cell" style={{ fontSize: 10 }}>
                      {j.kind === "cve_intel_hunt" ? `${j.spec.slug ?? "?"}${j.spec.mode ? ` · ${j.spec.mode}` : ""}`
                        : j.kind === "github_scan" ? String(j.spec.repo ?? "?")
                        : (j.project_id ? "project surface" : "?")}
                    </code></td>
                    <td className="mono-cell">{intervalLabel(j.interval_seconds)}</td>
                    <td className="time-cell"><Clock size={10} style={{ marginRight: 4, verticalAlign: "middle" }} />{relTime(j.next_run_at)}</td>
                    <td className="time-cell">{relTime(j.last_run_at)}</td>
                    <td>
                      <span className="mono-cell" style={{
                        color: j.last_status === "ok" ? "var(--good)" : j.last_status ? "var(--bad)" : "var(--muted)",
                      }}>{j.last_status ?? "never run"}</span>
                    </td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="action-btn" style={{ fontSize: 11 }} onClick={() => toggle(j)}>
                        {j.enabled ? "Pause" : "Enable"}
                      </button>
                      <button className="action-btn" style={{ color: "var(--bad)", borderColor: "var(--bad)" }} onClick={() => remove(j)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : approvals.length === 0 ? (
        <div className="empty-state-block"><p>No pending approvals. Jobs run in the background.</p></div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Execution</th><th>Action class</th><th>Expires</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {approvals.map((a) => (
                <tr key={a.id} className="data-row">
                  <td><code className="mono-cell">{a.execution_id.slice(0, 12)}…</code></td>
                  <td><code className="type-badge">{a.action_class}</code></td>
                  <td className="time-cell">{new Date(a.expires_at).toLocaleString()}</td>
                  <td>
                    <button className="action-btn primary" style={{ marginRight: 6 }} onClick={() => decide(a.id, "approved")}>
                      <CheckCircle2 size={13} /> Approve
                    </button>
                    <button className="action-btn" onClick={() => decide(a.id, "denied")}>
                      <XIcon size={13} /> Deny
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewJobModal
          onClose={() => setShowNew(false)}
          onCreated={(j) => { setJobs((prev) => [...prev, j]); setShowNew(false); flash("Scheduled job created"); }}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 200, background: "var(--panel)",
          border: "1px solid var(--accent)", color: "var(--accent)", padding: "9px 16px",
          borderRadius: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        }}>{toast}</div>
      )}
    </div>
  );
}

function NewJobModal({ onClose, onCreated }: { onClose: () => void; onCreated: (j: ScheduledJob) => void }) {
  const [kind, setKind] = useState("cve_intel_hunt");
  const [interval, setIntervalSec] = useState(86400);
  const [projectId, setProjectId] = useState("");
  // kind-specific spec
  const [slug, setSlug] = useState("");
  const [mode, setMode] = useState("static");
  const [repo, setRepo] = useState("");
  const [scope, setScope] = useState("full");
  const [failOn, setFailOn] = useState("high");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { fetchProjects().then((ps) => { if (ps.length) setProjectId(ps[0].id); }); }, []);

  async function submit() {
    setErr("");
    let spec: Record<string, unknown> = {};
    if (kind === "cve_intel_hunt") {
      if (!slug.trim()) { setErr("Slug is required for a CVE-intel hunt."); return; }
      spec = { slug: slug.trim(), mode };
    } else if (kind === "github_scan") {
      if (!repo.trim()) { setErr("Repo (owner/repo or path) is required."); return; }
      spec = { repo: repo.trim(), scope, fail_on: failOn };
    } else if (kind === "surface_rescan") {
      if (!projectId) { setErr("A project is required for surface rescan."); return; }
    }
    setBusy(true);
    try {
      const job = await createScheduledJob({
        kind, interval_seconds: interval, spec,
        project_id: projectId || undefined,
      });
      onCreated(job);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create job");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>New scheduled job</h2>
          <button onClick={onClose}><XIcon size={16} /></button>
        </div>
        <div className="modal-field">
          <label>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>

        {kind === "cve_intel_hunt" && (
          <>
            <div className="modal-field">
              <label>Plugin/theme slug</label>
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. contact-form-7" />
            </div>
            <div className="modal-field">
              <label>Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="static">Static (read-only)</option>
                <option value="full">Full (bench — opt-in)</option>
              </select>
            </div>
          </>
        )}
        {kind === "github_scan" && (
          <>
            <div className="modal-field">
              <label>Repository</label>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo or /path/to/checkout" />
            </div>
            <div className="modal-field">
              <label>Scope</label>
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="full">Full tree</option>
                <option value="diff">Diff only</option>
              </select>
            </div>
            <div className="modal-field">
              <label>Fail on</label>
              <select value={failOn} onChange={(e) => setFailOn(e.target.value)}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </>
        )}
        {kind === "surface_rescan" && (
          <div className="modal-field">
            <label>Scope</label>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Rescans the active project's attack surface and notifies on new hosts.</div>
          </div>
        )}

        <div className="modal-field">
          <label>Interval</label>
          <select value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))}>
            {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>
        </div>

        {err && <div style={{ color: "var(--bad)", fontSize: 12 }}>{err}</div>}
        <div className="modal-actions">
          <button className="action-btn" onClick={onClose}>Cancel</button>
          <button className="action-btn primary" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create job"}
          </button>
        </div>
      </div>
    </div>
  );
}
