import { useEffect, useState } from "react";
import { Activity as ActivityIcon, Filter } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Event = {
  id: string;
  event_type: string;
  occurred_at: string;
  actor_type: string;
  payload: Record<string, unknown>;
};

function payloadPreview(payload: Record<string, unknown>): string {
  if (!payload || typeof payload !== "object") return "—";
  const keys = Object.keys(payload);
  if (keys.length === 0) return "{}";
  const first = keys[0];
  const val = payload[first];
  const str = typeof val === "string" ? val : JSON.stringify(val);
  const preview = `${first}: ${str}`;
  return preview.length > 60 ? preview.slice(0, 57) + "…" : preview;
}

export default function Activity() {
  const [rows, setRows] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  async function load() {
    try {
      const key = getApiKey();
      const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
      const projects = await (await fetch("/api/v1/projects", { headers })).json();
      const projectId: string = projects[0]?.id ?? "";
      if (!projectId) { setLoading(false); return; }
      const r = await fetch(`/api/v1/projects/${projectId}/events?limit=200`, { headers });
      const data = r.ok ? await r.json() : [];
      setRows(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().then(() => { if (cancelled) return; });

    const interval = setInterval(() => {
      if (!cancelled) load();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const filtered = filter
    ? rows.filter((r) => r.event_type.toLowerCase().includes(filter.toLowerCase()))
    : rows;

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <ActivityIcon size={16} />
          <span>Activity</span>
          <small>{filtered.length}</small>
        </div>
        <div className="toolbar-actions">
          <div className="filter-input-wrap">
            <Filter size={13} />
            <input
              placeholder="Filter by event type…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading activity…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state-block">
          <p>No activity yet. Events will appear here as the platform runs.</p>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Actor</th>
                <th>Payload</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev) => (
                <tr key={ev.id} className="data-row">
                  <td>
                    <code className="type-badge">{ev.event_type}</code>
                  </td>
                  <td className="muted-cell">{ev.actor_type ?? "—"}</td>
                  <td>
                    <span className="mono-cell" style={{ fontSize: 11 }}>
                      {payloadPreview(ev.payload)}
                    </span>
                  </td>
                  <td className="time-cell">
                    {new Date(ev.occurred_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
