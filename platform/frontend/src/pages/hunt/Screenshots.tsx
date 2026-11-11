import { useEffect, useState } from "react";
import { Camera, RefreshCw, AlertTriangle, ExternalLink } from "lucide-react";
import {
  fetchProjects, fetchScreenshots, captureScreenshots, fetchScreenshotImage,
  type Screenshot,
} from "../../lib/api";

const label: React.CSSProperties = {
  fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--muted)", marginBottom: 4,
};

function Shot({ projectId, shot }: { projectId: string; shot: Screenshot }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    let obj: string | null = null;
    if (shot.status === "ok") {
      fetchScreenshotImage(projectId, shot.id).then((u) => { if (!dead) { obj = u; setSrc(u); } });
    }
    return () => { dead = true; if (obj) URL.revokeObjectURL(obj); };
  }, [projectId, shot.id, shot.status]);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--panel)" }}>
      <div style={{ height: 180, background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {shot.status === "error" ? (
          <div style={{ color: "var(--bad)", fontSize: 11, display: "flex", alignItems: "center", gap: 6, padding: 10, textAlign: "center" }}>
            <AlertTriangle size={14} /> {shot.error || "capture failed"}
          </div>
        ) : src ? (
          <img src={src} alt={shot.url} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
        ) : (
          <span style={{ color: "var(--muted)", fontSize: 11 }}>loading…</span>
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <a href={shot.url} target="_blank" rel="noreferrer"
           style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "var(--text)", wordBreak: "break-all", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
          {shot.url} <ExternalLink size={10} style={{ color: "var(--muted)", flexShrink: 0 }} />
        </a>
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>{new Date(shot.captured_at).toLocaleString()}</div>
      </div>
    </div>
  );
}

export default function Screenshots() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [shots, setShots] = useState<Screenshot[]>([]);
  const [urls, setUrls] = useState("");
  const [backend, setBackend] = useState<"auto" | "chromium" | "gowitness">("auto");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    (async () => {
      const ps = await fetchProjects();
      setProjects(ps);
      if (ps.length) setProjectId((c) => c || ps[0].id);
    })();
  }, []);

  async function load(pid: string) { if (pid) setShots(await fetchScreenshots(pid)); }
  useEffect(() => { void load(projectId); }, [projectId]);

  async function doCapture() {
    const list = urls.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    setBusy(true); setToast("");
    try {
      const r = await captureScreenshots(projectId, list, backend);
      setToast(`${r.captured} of ${r.results.length} captured`);
      await load(projectId);
    } catch (e: any) {
      setToast(e.message || "capture failed");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: 20, maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <Camera size={20} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 18, margin: 0 }}>Screenshots</h1>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>headless-browser visual triage of in-scope hosts</span>
        <div style={{ flex: 1 }} />
        <select className="action-btn" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="action-btn" onClick={() => load(projectId)} title="Refresh"><RefreshCw size={13} /></button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={urls} onChange={(e) => setUrls(e.target.value)}
          placeholder="https://app.target.com  https://admin.target.com  (space/comma separated; must be in scope)"
          style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6,
                   padding: "8px 12px", color: "var(--text)", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
        />
        <select className="action-btn" value={backend} onChange={(e) => setBackend(e.target.value as any)}
                title="Capture backend">
          <option value="auto">auto</option>
          <option value="chromium">chromium</option>
          <option value="gowitness">gowitness</option>
        </select>
        <button className="action-btn" disabled={busy} onClick={doCapture} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Camera size={13} /> {busy ? "capturing…" : "Capture"}
        </button>
      </div>
      {toast && <div style={{ fontSize: 11, color: "var(--info)", marginBottom: 12 }}>{toast}</div>}

      <div style={label}>Gallery ({shots.length})</div>
      {shots.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>Capture an in-scope URL to triage it visually.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {shots.map((s) => <Shot key={s.id} projectId={projectId} shot={s} />)}
        </div>
      )}
    </div>
  );
}
