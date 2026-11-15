import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, ChevronRight, Info, Search, Crosshair, XOctagon, Zap, Shield, FileText } from "lucide-react";
import { fetchCampaign, cancelCampaign, fetchCampaignEvents } from "../../lib/api";

type Campaign = {
  id: string; name: string; target_url: string; hunt_type: string; status: string;
  phase: string | null; progress: number; findings_count: number; agent_ids: string | null;
  started_at: string | null; finished_at: string | null; created_at: string; error: string | null;
  report_md: string | null;
};

type CampaignEvent = {
  id: number; phase: string | null; event_type: string; summary: string;
  detail: unknown; occurred_at: string;
};

const PHASES = [
  { key: "recon",    label: "Recon",    Icon: Search },
  { key: "fuzz",     label: "Fuzz",     Icon: Zap },
  { key: "validate", label: "Validate", Icon: Shield },
  { key: "report",   label: "Report",   Icon: FileText },
];

function statusColor(s: string) {
  if (s === "running") return "var(--accent)";
  if (s === "done")    return "#4ade80";
  if (s === "failed")  return "#f87171";
  return "var(--muted)";
}

function phaseIndex(phase: string | null) {
  if (!phase) return -1;
  return PHASES.findIndex((p) => phase.startsWith(p.key));
}

function eventDotColor(type: string) {
  if (type === "finding") return "#f87171";
  if (type === "error")   return "#fb923c";
  if (type === "warning") return "#fcd34d";
  if (type === "agent")   return "#4ade80";
  return "var(--muted)";
}

function EventIcon({ type }: { type: string }) {
  const size = 11;
  if (type === "finding") return <AlertCircle size={size} style={{ color: "#f87171", flexShrink: 0 }} />;
  if (type === "error")   return <XOctagon size={size} style={{ color: "#fb923c", flexShrink: 0 }} />;
  if (type === "warning") return <AlertCircle size={size} style={{ color: "#fcd34d", flexShrink: 0 }} />;
  if (type === "done")    return <CheckCircle2 size={size} style={{ color: "#4ade80", flexShrink: 0 }} />;
  return <Info size={size} style={{ color: "var(--muted)", flexShrink: 0 }} />;
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function loadCampaign() {
    if (!id) return;
    fetchCampaign(id).then((data) => {
      setCampaign(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  function loadEvents() {
    if (!id) return;
    fetchCampaignEvents(id).then((data) => {
      setEvents((prev) => {
        const merged = [...prev, ...data.filter((e) => !prev.some((p) => p.id === e.id))];
        return merged.slice(-200);
      });
    }).catch(() => {});
  }

  useEffect(() => {
    loadCampaign();
    loadEvents();
    intervalRef.current = setInterval(loadCampaign, 5000);
    eventsIntervalRef.current = setInterval(loadEvents, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (eventsIntervalRef.current) clearInterval(eventsIntervalRef.current);
    };
  }, [id]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events.length]);

  async function handleCancel() {
    if (!id || cancelling) return;
    setCancelling(true);
    try {
      await cancelCampaign(id);
      loadCampaign();
    } catch {
      // ignore
    } finally {
      setCancelling(false);
    }
  }

  if (loading) return <div className="page-loading">Loading campaign…</div>;
  if (!campaign) return (
    <div className="empty-state-block">
      <p>Campaign not found.</p>
      <button className="action-btn" style={{ marginTop: 8 }} onClick={() => navigate("/hunt/campaigns")}>
        Back to Campaigns
      </button>
    </div>
  );

  const curPhaseIdx = phaseIndex(campaign.phase);
  const agents: string[] = campaign.agent_ids ? (JSON.parse(campaign.agent_ids) as string[]) : [];
  const canCancel = campaign.status === "queued" || campaign.status === "running";

  return (
    <div className="page-targets" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Toolbar */}
      <div className="page-toolbar">
        <div className="page-title" style={{ gap: 6 }}>
          <Crosshair size={15} />
          <Link to="/hunt/campaigns" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 12 }}>
            Campaigns
          </Link>
          <ChevronRight size={12} style={{ color: "var(--muted)" }} />
          <span style={{ fontSize: 13 }}>{campaign.name}</span>
          <span className={`mc-status-badge ${campaign.status}`}>{campaign.status}</span>
        </div>
        {canCancel && (
          <button className="action-btn" style={{ color: "#f87171", borderColor: "#f87171" }} onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel Campaign"}
          </button>
        )}
      </div>

      <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Target + progress */}
        <div className="mc-panel" style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
            <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "var(--accent)" }}>
              {campaign.target_url}
            </code>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>
              {campaign.hunt_type}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="mc-progress-bar" style={{ flex: 1, height: 4 }}>
              <div
                className="mc-progress-fill"
                style={{ width: `${campaign.progress}%`, height: "100%", background: statusColor(campaign.status) }}
              />
            </div>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
              {campaign.progress}%
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
              {campaign.findings_count} finding{campaign.findings_count !== 1 ? "s" : ""}
            </span>
          </div>
          {campaign.error && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(248,113,113,0.1)", borderRadius: 4, fontSize: 11, color: "#f87171" }}>
              {campaign.error}
            </div>
          )}
        </div>

        {/* Phase timeline */}
        <div className="mc-panel" style={{ padding: "14px 20px" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 14, fontWeight: 600 }}>
            Phase Timeline
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {PHASES.map((p, idx) => {
              const isDone    = campaign.status === "done" || idx < curPhaseIdx;
              const isActive  = idx === curPhaseIdx && campaign.status === "running";
              const isFailed  = campaign.status === "failed" && idx === curPhaseIdx;
              const color     = isFailed ? "#f87171" : (isDone || isActive) ? (isActive ? "var(--accent)" : "#4ade80") : "var(--muted)";
              const bgColor   = isActive ? "color-mix(in srgb, var(--accent) 15%, transparent)" : isDone ? "color-mix(in srgb, #4ade80 10%, transparent)" : "transparent";
              const borderColor = isActive ? "var(--accent)" : isDone ? "#4ade80" : "var(--border)";
              return (
                <>
                  <div
                    key={p.key}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                      padding: "10px 16px", borderRadius: 6, border: `1px solid ${borderColor}`,
                      background: bgColor, minWidth: 80,
                    }}
                  >
                    <p.Icon size={16} style={{ color }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color }}>{p.label}</span>
                    {isActive && (
                      <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", color: "var(--accent)", letterSpacing: "0.1em" }}>
                        ACTIVE
                      </span>
                    )}
                    {isDone && !isActive && (
                      <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", color: "#4ade80", letterSpacing: "0.1em" }}>
                        DONE
                      </span>
                    )}
                    {isFailed && (
                      <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", color: "#f87171", letterSpacing: "0.1em" }}>
                        FAILED
                      </span>
                    )}
                  </div>
                  {idx < PHASES.length - 1 && (
                    <div key={`line-${p.key}`} style={{ flex: 1, height: 1, background: idx < curPhaseIdx ? "#4ade80" : "var(--border)" }} />
                  )}
                </>
              );
            })}
          </div>
        </div>

        {/* Live event feed */}
        <div className="mc-panel">
          <div className="mc-panel-head">
            <span className="mc-panel-title">Event Log</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "var(--muted)" }}>
              {events.length} events
            </span>
          </div>
          <div
            ref={feedRef}
            style={{ height: 400, overflowY: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
          >
            {events.length === 0 ? (
              <div className="mc-empty">No events yet. Campaign events will appear here.</div>
            ) : (
              events.map((ev, i) => (
                <div
                  key={ev.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "60px 16px auto 1fr",
                    alignItems: "start",
                    gap: 8,
                    padding: "7px 14px",
                    borderBottom: "1px solid var(--border)",
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                  }}
                >
                  <span style={{ color: "var(--muted)", fontSize: 10, whiteSpace: "nowrap" }}>{fmtTime(ev.occurred_at)}</span>
                  <EventIcon type={ev.event_type} />
                  {ev.phase && (
                    <span style={{ padding: "1px 5px", borderRadius: 3, fontSize: 9, background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
                      {ev.phase}
                    </span>
                  )}
                  {!ev.phase && <span />}
                  <span style={{ color: "var(--text)", lineHeight: 1.4, minWidth: 0, wordBreak: "break-word" }}>
                    {ev.summary}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Report */}
        {campaign.report_md && (
          <div className="mc-panel">
            <div className="mc-panel-head">
              <span className="mc-panel-title">Report</span>
            </div>
            <pre style={{ margin: 0, padding: "14px 16px", fontSize: 12, lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text)", fontFamily: "'JetBrains Mono', monospace" }}>
              {campaign.report_md}
            </pre>
          </div>
        )}

        {/* Agent fleet */}
        {agents.length > 0 && (
          <div className="mc-panel" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 10, fontWeight: 600 }}>
              Agent Fleet
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {agents.map((a) => (
                <code key={a} style={{ padding: "3px 8px", borderRadius: 4, background: "var(--panel)", border: "1px solid var(--border)", fontSize: 11, color: "var(--accent)" }}>
                  {a.slice(0, 12)}…
                </code>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
