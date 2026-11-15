import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Crosshair, Plus, X } from "lucide-react";
import { fetchProjects, fetchCampaigns, createCampaign, fetchProviders } from "../../lib/api";

type Campaign = {
  id: string; name: string; target_url: string; hunt_type: string; status: string;
  phase: string | null; progress: number; findings_count: number;
  started_at: string | null; created_at: string;
};

type Provider = { id: string; name: string; enabled: boolean };

const HUNT_TYPES = [
  { value: "full_auto",     label: "Full Auto" },
  { value: "recon_only",    label: "Recon Only" },
  { value: "api_fuzz",      label: "API Fuzz" },
  { value: "source_review", label: "Source Review" },
];

const RUNTIMES = [
  { value: 900,   label: "15 min" },
  { value: 1800,  label: "30 min" },
  { value: 3600,  label: "1 hour" },
  { value: 14400, label: "4 hours" },
  { value: 28800, label: "8 hours" },
];

function statusColor(s: string) {
  if (s === "running") return "var(--accent)";
  if (s === "done")    return "#4ade80";
  if (s === "failed")  return "#f87171";
  return "var(--muted)";
}

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Campaigns() {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState({ name: "", target_url: "", hunt_type: "full_auto", provider_id: "", max_runtime: 3600 });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchProjects().then((p) => {
      if (p.length) setProjectId(p[0].id);
      else setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function loadCampaigns(pid: string) {
    fetchCampaigns(pid)
      .then((data) => { setCampaigns(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    if (!projectId) return;
    loadCampaigns(projectId);
    intervalRef.current = setInterval(() => loadCampaigns(projectId), 6000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [projectId]);

  function openModal() {
    fetchProviders().then(setProviders).catch(() => {});
    setForm({ name: "", target_url: "", hunt_type: "full_auto", provider_id: "", max_runtime: 3600 });
    setErr("");
    setModal(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setSubmitting(true);
    setErr("");
    try {
      const payload: Parameters<typeof createCampaign>[1] = {
        name: form.name,
        target_url: form.target_url,
        hunt_type: form.hunt_type,
        max_runtime: form.max_runtime,
      };
      if (form.provider_id) payload.provider_id = form.provider_id;
      const created = await createCampaign(projectId, payload);
      setModal(false);
      if (projectId) loadCampaigns(projectId);
      navigate(`/hunt/campaigns/${created.id}`);
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Failed to create campaign");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Crosshair size={16} />
          <span>Campaigns</span>
          <small>{campaigns.length} total</small>
        </div>
        <button className="action-btn primary" onClick={openModal}>
          <Plus size={13} /> New Campaign
        </button>
      </div>

      {loading ? (
        <div className="page-loading">Loading…</div>
      ) : campaigns.length === 0 ? (
        <div className="empty-state-block">
          <Crosshair size={32} style={{ color: "var(--muted)", marginBottom: 8 }} />
          <p>No campaigns yet. Launch your first autonomous hunt.</p>
          <button className="action-btn primary" style={{ marginTop: 8 }} onClick={openModal}>
            <Plus size={13} /> New Campaign
          </button>
        </div>
      ) : (
        <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="mc-panel"
              style={{ cursor: "pointer", transition: "border-color 0.15s" }}
              onClick={() => navigate(`/hunt/campaigns/${c.id}`)}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              <div style={{ padding: "12px 14px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{c.name}</span>
                  <span className={`mc-status-badge ${c.status}`}>{c.status}</span>
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "var(--muted)", marginBottom: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.target_url}
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "#131619", color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                    {c.hunt_type}
                  </span>
                  {c.phase && (
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {c.phase}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div className="mc-progress-bar" style={{ flex: 1 }}>
                    <div className="mc-progress-fill" style={{ width: `${c.progress}%`, background: statusColor(c.status) }} />
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>{c.progress}%</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)" }}>
                  <span>{c.findings_count} finding{c.findings_count !== 1 ? "s" : ""}</span>
                  <span>{fmt(c.started_at || c.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="mc-panel" style={{ width: 480, maxWidth: "90vw" }}>
            <div className="mc-panel-head">
              <span className="mc-panel-title">New Campaign</span>
              <button style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }} onClick={() => setModal(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={submit} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Campaign Name
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Remitly API Fuzz Q4"
                  style={{ height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Target URL
                <input
                  required
                  type="url"
                  value={form.target_url}
                  onChange={(e) => setForm((f) => ({ ...f, target_url: e.target.value }))}
                  placeholder="https://api.target.com"
                  style={{ height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none", fontFamily: "'JetBrains Mono', monospace" }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Hunt Type
                  <select
                    value={form.hunt_type}
                    onChange={(e) => setForm((f) => ({ ...f, hunt_type: e.target.value }))}
                    style={{ height: 32, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
                  >
                    {HUNT_TYPES.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Max Runtime
                  <select
                    value={form.max_runtime}
                    onChange={(e) => setForm((f) => ({ ...f, max_runtime: Number(e.target.value) }))}
                    style={{ height: 32, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
                  >
                    {RUNTIMES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
              </div>
              {providers.length > 0 && (
                <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  AI Provider (optional)
                  <select
                    value={form.provider_id}
                    onChange={(e) => setForm((f) => ({ ...f, provider_id: e.target.value }))}
                    style={{ height: 32, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
                  >
                    <option value="">— use default —</option>
                    {providers.filter((p) => p.enabled).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              {err && (
                <div style={{ fontSize: 11, color: "#f87171", padding: "8px 10px", background: "rgba(248,113,113,0.1)", borderRadius: 4 }}>
                  {err}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                <button type="button" className="action-btn" onClick={() => setModal(false)}>Cancel</button>
                <button type="submit" className="action-btn primary" disabled={submitting}>
                  {submitting ? "Launching…" : "Launch Campaign"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
