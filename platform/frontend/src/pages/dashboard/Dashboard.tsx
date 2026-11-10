import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X, RefreshCw } from "lucide-react";
import {
  fetchProjects, fetchScore, fetchEvents, fetchCampaigns,
  createCampaign, fetchProviders,
} from "../../lib/api";

type Project    = { id: string; name: string; slug: string };
type ScoreData  = { score: number; needs_attention: boolean; breakdown: Record<string, number>; total_active: number };
type EventRow   = { id: number; event_type: string; occurred_at: string; actor_type: string };
type Campaign   = { id: string; name: string; target_url: string; hunt_type: string; status: string; phase: string | null; progress: number; findings_count: number; started_at: string | null; created_at: string };
type Provider   = { id: string; name: string; enabled: boolean };

const HUNT_TYPES = [
  { value: "full_auto",     label: "Full Auto"     },
  { value: "recon_only",    label: "Recon Only"    },
  { value: "api_fuzz",      label: "API Fuzz"      },
  { value: "source_review", label: "Source Review" },
];

const RUNTIMES = [
  { value: 1800,  label: "30 min"  },
  { value: 3600,  label: "1 hour"  },
  { value: 7200,  label: "2 hours" },
  { value: 14400, label: "4 hours" },
];

function feedDot(eventType: string): string {
  if (eventType.startsWith("finding")) return "finding";
  if (eventType.startsWith("agent") || eventType.startsWith("campaign.started")) return "agent";
  if (eventType.startsWith("campaign")) return "campaign";
  return "default";
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function Dashboard() {
  const [project, setProject]       = useState<Project | null>(null);
  const [score, setScore]           = useState<ScoreData | null>(null);
  const [events, setEvents]         = useState<EventRow[]>([]);
  const [campaigns, setCampaigns]   = useState<Campaign[]>([]);
  const [providers, setProviders]   = useState<Provider[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showNew, setShowNew]       = useState(false);
  const navigate = useNavigate();
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = async (pid: string) => {
    const [sc, evts, camps] = await Promise.all([
      fetchScore(pid), fetchEvents(pid, 40), fetchCampaigns(pid),
    ]);
    setScore(sc); setEvents(evts); setCampaigns(camps);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const projects = await fetchProjects();
      if (!alive) return;
      if (!projects.length) { setLoading(false); return; }
      const p = projects[0];
      setProject(p);
      const [provs] = await Promise.all([fetchProviders(), load(p.id)]);
      if (alive) setProviders(provs);
      setLoading(false);
      pollRef.current = setInterval(() => load(p.id), 8000);
    })();
    return () => { alive = false; clearInterval(pollRef.current); };
  }, []);

  if (loading) return <div className="page-loading">Loading…</div>;
  if (!project) return <NoProject />;

  const totalFindings = score?.total_active ?? 0;
  const critical      = score?.breakdown?.critical ?? 0;
  const running       = campaigns.filter(c => c.status === "running").length;
  const endpoints     = 0;

  return (
    <div className="mc-page">
      <div className="mc-kpi-row">
        <KPI label="Active Campaigns" value={campaigns.length} sub={`${running} running`} subClass={running > 0 ? "good" : undefined} />
        <KPI label="Open Findings" value={totalFindings} sub={critical > 0 ? `${critical} critical` : "clear"} subClass={critical > 0 ? "bad" : "good"} />
        <KPI label="Agents Running" value={running} sub={running > 0 ? "in progress" : "idle"} />
        <KPI label="Endpoints Mapped" value={endpoints} sub="via genome" />
      </div>

      <div className="mc-body">
        <div className="mc-main">
          <div className="mc-panel mc-campaigns" style={{ flex: 1 }}>
            <div className="mc-panel-head">
              <span className="mc-panel-title">Hunt Campaigns</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="action-btn" onClick={() => load(project.id)} title="Refresh">
                  <RefreshCw size={12} />
                </button>
                <button className="action-btn primary" onClick={() => setShowNew(true)}>
                  <Plus size={12} /> New Campaign
                </button>
              </div>
            </div>
            <div className="mc-panel-body">
              {campaigns.length === 0
                ? <div className="mc-empty">No campaigns yet. Launch one to begin autonomous hunting.</div>
                : campaigns.map(c => (
                  <div key={c.id} className="mc-campaign-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="mc-campaign-name">{c.name}</div>
                      <div className="mc-campaign-url">{c.target_url}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <span className={`mc-status-badge ${c.status}`}>{c.phase ?? c.status}</span>
                      {c.status === "running" && (
                        <div className="mc-progress-bar">
                          <div className="mc-progress-fill" style={{ width: `${c.progress}%` }} />
                        </div>
                      )}
                    </div>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--accent)" }}>
                      {c.findings_count} findings
                    </span>
                  </div>
                ))
              }
            </div>
          </div>

          <div className="mc-panel" style={{ flex: "none" }}>
            <div className="mc-panel-head">
              <span className="mc-panel-title">Quick Actions</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 14px" }}>
              <button className="action-btn" onClick={() => navigate("/hunt/targets")}>Review Targets</button>
              <button className="action-btn" onClick={() => navigate("/hunt/findings")}>Triage Findings</button>
              <button className="action-btn" onClick={() => navigate("/workspace/agents")}>Agent Fleet</button>
              <button className="action-btn" onClick={() => navigate("/hunt/campaigns")}>All Campaigns</button>
            </div>
          </div>
        </div>

        <div className="mc-panel mc-feed" style={{ overflow: "hidden" }}>
          <div className="mc-panel-head">
            <span className="mc-panel-title">Live Feed</span>
          </div>
          <div className="mc-feed-list">
            {events.length === 0
              ? <div className="mc-empty">No events yet.</div>
              : events.map(e => (
                <div key={e.id} className="mc-feed-item">
                  <span className={`mc-feed-dot ${feedDot(e.event_type)}`} />
                  <div className="mc-feed-text">
                    <strong>{e.event_type.replace(/\./g, " ")}</strong>
                  </div>
                  <span className="mc-feed-time">{relTime(e.occurred_at)}</span>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {showNew && (
        <NewCampaignModal
          projectId={project.id}
          providers={providers}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(project.id); }}
        />
      )}
    </div>
  );
}

function KPI({ label, value, sub, subClass }: { label: string; value: number; sub?: string; subClass?: string }) {
  return (
    <div className="mc-kpi">
      <div className="mc-kpi-label">{label}</div>
      <div className="mc-kpi-value">{value}</div>
      {sub && <div className={`mc-kpi-sub ${subClass ?? ""}`}>{sub}</div>}
    </div>
  );
}

function NoProject() {
  const navigate = useNavigate();
  return (
    <div style={{ padding: 32, display: "grid", gap: 12 }}>
      <div className="demo-banner">No project found — create a target to get started.</div>
      <button className="action-btn primary" style={{ width: "fit-content" }} onClick={() => navigate("/hunt/targets")}>
        <Plus size={14} /> Add first target
      </button>
    </div>
  );
}

function NewCampaignModal({ projectId, providers, onClose, onCreated }: {
  projectId: string; providers: Provider[];
  onClose: () => void; onCreated: () => void;
}) {
  const [name, setName]           = useState("");
  const [url, setUrl]             = useState("");
  const [huntType, setHuntType]   = useState("full_auto");
  const [providerId, setProviderId] = useState("");
  const [maxRuntime, setMaxRuntime] = useState(3600);
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState("");

  const submit = async () => {
    if (!name.trim() || !url.trim()) { setErr("Name and target URL are required."); return; }
    setBusy(true);
    try {
      await createCampaign(projectId, {
        name: name.trim(), target_url: url.trim(),
        hunt_type: huntType,
        provider_id: providerId || undefined,
        max_runtime: maxRuntime,
      });
      onCreated();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create campaign");
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>New Campaign</h2>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-field">
          <label>Campaign name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. ACME API recon" />
        </div>
        <div className="modal-field">
          <label>Target URL</label>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com" />
        </div>
        <div className="modal-field">
          <label>Hunt type</label>
          <select value={huntType} onChange={e => setHuntType(e.target.value)}>
            {HUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {providers.length > 0 && (
          <div className="modal-field">
            <label>AI Provider</label>
            <select value={providerId} onChange={e => setProviderId(e.target.value)}>
              <option value="">Auto-select</option>
              {providers.filter(p => p.enabled).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div className="modal-field">
          <label>Max runtime</label>
          <select value={maxRuntime} onChange={e => setMaxRuntime(Number(e.target.value))}>
            {RUNTIMES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {err && <div style={{ color: "var(--bad)", fontSize: 12 }}>{err}</div>}
        <div className="modal-actions">
          <button className="action-btn" onClick={onClose}>Cancel</button>
          <button className="action-btn primary" onClick={submit} disabled={busy}>
            {busy ? "Launching…" : "Launch Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
