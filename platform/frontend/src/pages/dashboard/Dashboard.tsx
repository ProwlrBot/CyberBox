import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Flame, Target as TargetIcon } from "lucide-react";
import { fetchProjects, fetchScore, fetchEvents } from "../../lib/api";

const SEV_COLOR: Record<string, string> = {
  critical: "var(--bad)", high: "var(--warn)", medium: "#fcd34d",
  low: "var(--good)", info: "var(--info)", unknown: "var(--muted)",
};
const SEV_ORDER = ["critical", "high", "medium", "low", "info", "unknown"];

type ScoreData = { score: number; needs_attention: boolean; breakdown: Record<string, number>; total_active: number };
type EventRow  = { id: number; event_type: string; occurred_at: string };

export default function Dashboard() {
  const [score, setScore] = useState<ScoreData | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [noProject, setNoProject] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const projects = await fetchProjects();
        if (cancelled) return;
        if (!projects.length) { setNoProject(true); setLoading(false); return; }
        const pid = projects[0].id;
        const [sc, evts] = await Promise.all([fetchScore(pid), fetchEvents(pid, 30)]);
        if (!cancelled) { setScore(sc); setEvents(evts); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="page-loading">Loading dashboard…</div>;
  if (noProject) return <DemoState />;

  const maxCount = score ? Math.max(1, ...SEV_ORDER.map((s) => score.breakdown[s] ?? 0)) : 1;

  return (
    <div className="dashboard">
      <div className="stat-row">
        <StatCard label="Security score" value={score?.score ?? 0} unit="/100"
          delta={score?.needs_attention ? "Needs attention" : "Healthy"}
          deltaGood={!score?.needs_attention} />
        <StatCard label="Active findings" value={score?.total_active ?? 0} />
        <StatCard label="Critical" value={score?.breakdown.critical ?? 0}
          deltaGood={!score?.breakdown.critical} delta={score?.breakdown.critical ? "Immediate action" : "Clear"} />
        <StatCard label="High" value={score?.breakdown.high ?? 0} />
      </div>

      <div className="dashboard-body">
        <section className="dashboard-section">
          <div className="section-label">Severity leaderboard</div>
          <table className="leaderboard-table">
            <thead><tr><th>Severity</th><th>Count</th><th>Distribution</th></tr></thead>
            <tbody>
              {SEV_ORDER.map((sev) => {
                const count = score?.breakdown[sev] ?? 0;
                return (
                  <tr key={sev} className="leaderboard-row" onClick={() => navigate("/hunt/findings")}>
                    <td><span className="sev-badge" style={{ color: SEV_COLOR[sev] }}>{sev}</span></td>
                    <td className="sev-count">{count}</td>
                    <td>
                      <div className="sev-bar-track">
                        <div className="sev-bar-fill"
                          style={{ width: `${Math.round((count / maxCount) * 100)}%`, background: SEV_COLOR[sev] }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="dashboard-section">
          <div className="section-label">Recent activity</div>
          <div className="activity-feed">
            {events.length === 0
              ? <p className="empty-state">No events yet. Run a scan to see activity.</p>
              : events.map((e) => (
                <div key={e.id} className="activity-row">
                  <code className="activity-type">{e.event_type}</code>
                  <time className="activity-time">{new Date(e.occurred_at).toLocaleTimeString()}</time>
                </div>
              ))
            }
          </div>
        </section>

        <section className="dashboard-section continue-section">
          <div className="section-label">Continue</div>
          <button className="continue-action" onClick={() => navigate("/hunt/targets")}>
            <TargetIcon size={18} />
            <div><strong>Review targets</strong><span>Add or confirm in-scope targets for this project</span></div>
          </button>
          <button className="continue-action" onClick={() => navigate("/hunt/findings")}>
            <AlertTriangle size={18} />
            <div>
              <strong>Triage findings</strong>
              <span>{score?.total_active ?? 0} open findings require review</span>
            </div>
          </button>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value, unit = "", delta = "", deltaGood = true }: {
  label: string; value: number; unit?: string; delta?: string; deltaGood?: boolean;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value"><span>{value}</span>{unit && <small>{unit}</small>}</div>
      {delta && <div className={`stat-delta ${deltaGood ? "good" : "bad"}`}>{delta}</div>}
    </div>
  );
}

function DemoState() {
  return (
    <div className="dashboard">
      <div className="demo-banner">
        <Flame size={16} />
        <span>No project found — connect the API and create a project to see live stats.</span>
      </div>
    </div>
  );
}
