import { useEffect, useState } from "react";
import { Radar, Camera, ArrowUpRight, ArrowDownRight, Clock } from "lucide-react";
import {
  fetchProjects, fetchSurfaceDrift, takeSurfaceSnapshot,
  type SurfaceDrift,
} from "../../lib/api";

function relTime(iso?: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function Surface() {
  const [projectId, setProjectId] = useState("");
  const [drift, setDrift] = useState<SurfaceDrift | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapping, setSnapping] = useState(false);
  const [toast, setToast] = useState("");

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3500); }

  useEffect(() => {
    let cancelled = false;
    fetchProjects().then(async (ps) => {
      if (cancelled || !ps.length) { setLoading(false); return; }
      const pid = ps[0].id;
      setProjectId(pid);
      setDrift(await fetchSurfaceDrift(pid));
      if (!cancelled) setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function snapshot() {
    if (!projectId) return;
    setSnapping(true);
    try {
      const snap = await takeSurfaceSnapshot(projectId);
      setDrift(await fetchSurfaceDrift(projectId));
      flash(`Snapshot captured — ${snap.host_count} host${snap.host_count === 1 ? "" : "s"}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Snapshot failed");
    } finally {
      setSnapping(false);
    }
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Radar size={16} />
          <span>Attack Surface</span>
          {drift && <small>{drift.current_count} host{drift.current_count === 1 ? "" : "s"}</small>}
        </div>
        <div className="toolbar-actions">
          {projectId && (
            <button className="action-btn primary" onClick={snapshot} disabled={snapping}>
              <Camera size={13} /> {snapping ? "Capturing…" : "Capture snapshot"}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading surface…</div>
      ) : !drift ? (
        <div className="empty-state-block"><p>No project selected.</p></div>
      ) : !drift.baseline ? (
        <div className="empty-state-block">
          <p>No snapshot yet. Capture a baseline to start monitoring attack-surface drift —
            new or vanished hosts between snapshots. Hosts come from the project's discovered
            assets (run recon first to populate them).</p>
        </div>
      ) : !drift.compared ? (
        <div className="empty-state-block">
          <p>Baseline captured ({drift.current_count} host{drift.current_count === 1 ? "" : "s"}).
            Capture another snapshot after recon re-runs to see what drifted.</p>
        </div>
      ) : (
        <div style={{ padding: 16, overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 11, color: "var(--muted)", alignItems: "center" }}>
            <Clock size={12} />
            <span>Comparing {relTime(drift.from)} → {relTime(drift.to)}</span>
          </div>

          <DriftList
            title="New hosts" count={drift.added.length} hosts={drift.added}
            color="var(--good)" Icon={ArrowUpRight}
            empty="No new hosts since the last snapshot."
          />
          <div style={{ height: 16 }} />
          <DriftList
            title="Vanished hosts" count={drift.removed.length} hosts={drift.removed}
            color="var(--bad)" Icon={ArrowDownRight}
            empty="No hosts vanished since the last snapshot."
          />
        </div>
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

function DriftList({ title, count, hosts, color, Icon, empty }: {
  title: string; count: number; hosts: string[]; color: string;
  Icon: React.FC<{ size?: number; style?: React.CSSProperties }>; empty: string;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--panel)" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "9px 14px",
        borderBottom: "1px solid var(--border)",
      }}>
        <Icon size={14} style={{ color }} />
        <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text)" }}>{title}</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color, marginLeft: "auto" }}>{count}</span>
      </div>
      {count === 0 ? (
        <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--muted)" }}>{empty}</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {hosts.map((h) => (
            <li key={h} style={{
              padding: "7px 14px", borderBottom: "1px solid var(--border)",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "var(--text)",
            }}>
              <code style={{ color }}>{h}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
