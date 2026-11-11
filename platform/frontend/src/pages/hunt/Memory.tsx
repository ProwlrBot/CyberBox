import { useEffect, useState } from "react";
import { Brain, Check, X as XIcon, Search as SearchIcon, Tag } from "lucide-react";
import {
  fetchMemorySuggestions, decideMemorySuggestion, searchMemory,
  type MemorySuggestion, type MemoryHit,
} from "../../lib/api";

type Tab = "review" | "search";

export default function Memory() {
  const [tab, setTab] = useState<Tab>("review");
  const [toast, setToast] = useState("");
  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3500); }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Brain size={16} />
          <span>Research Memory</span>
        </div>
        <div className="toolbar-actions">
          <button className={`action-btn${tab === "review" ? " primary" : ""}`} onClick={() => setTab("review")}>Review</button>
          <button className={`action-btn${tab === "search" ? " primary" : ""}`} onClick={() => setTab("search")}>Search</button>
        </div>
      </div>

      {tab === "review" ? <ReviewTab flash={flash} /> : <SearchTab />}

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

function ReviewTab({ flash }: { flash: (m: string) => void }) {
  const [items, setItems] = useState<MemorySuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setItems(await fetchMemorySuggestions("pending"));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function decide(s: MemorySuggestion, decision: "approved" | "rejected", edited?: { title: string; lesson: string }) {
    setBusy(s.id);
    try {
      await decideMemorySuggestion(s.id, decision === "approved"
        ? { decision, title: edited?.title, lesson: edited?.lesson, technology_tags: s.technology_tags }
        : { decision });
      setItems((prev) => prev.filter((i) => i.id !== s.id));
      flash(decision === "approved" ? "Lesson promoted to memory" : "Suggestion rejected");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="page-loading">Loading suggestions…</div>;
  if (!items.length) return (
    <div className="empty-state-block">
      <p>No pending lessons to review. Suggestions are proposed when you record feedback on
        findings, hypotheses, or campaign outcomes — approved ones become searchable research memory.</p>
    </div>
  );

  return (
    <div style={{ padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((s) => (
        <SuggestionCard key={s.id} s={s} busy={busy === s.id} onDecide={decide} />
      ))}
    </div>
  );
}

function SuggestionCard({ s, busy, onDecide }: {
  s: MemorySuggestion; busy: boolean;
  onDecide: (s: MemorySuggestion, d: "approved" | "rejected", e?: { title: string; lesson: string }) => void;
}) {
  const [title, setTitle] = useState(s.title);
  const [lesson, setLesson] = useState(s.lesson);
  const fieldStyle: React.CSSProperties = {
    background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)",
    padding: "6px 9px", borderRadius: 4, fontSize: 12, outline: "none", width: "100%",
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--panel)", padding: 14 }}>
      <input style={{ ...fieldStyle, fontWeight: 600, marginBottom: 8 }} value={title}
        onChange={(e) => setTitle(e.target.value)} placeholder="Lesson title" />
      <textarea style={{ ...fieldStyle, fontFamily: "'JetBrains Mono', monospace", resize: "vertical" }}
        rows={3} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="The lesson…" />
      {s.technology_tags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 4px" }}>
          {s.technology_tags.map((t) => (
            <span key={t} className="type-badge" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Tag size={10} /> {t}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button className="action-btn" disabled={busy} onClick={() => onDecide(s, "rejected")}>
          <XIcon size={13} /> Reject
        </button>
        <button className="action-btn primary" disabled={busy || !lesson.trim()}
          onClick={() => onDecide(s, "approved", { title, lesson })}>
          <Check size={13} /> {busy ? "Saving…" : "Approve"}
        </button>
      </div>
    </div>
  );
}

function SearchTab() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MemoryHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    try { setHits(await searchMemory(q.trim())); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: 16, overflowY: "auto" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <div className="filter-input-wrap" style={{ flex: 1 }}>
          <SearchIcon size={13} />
          <input placeholder="Search learned lessons…" value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }} />
        </div>
        <button className="action-btn primary" onClick={run} disabled={busy || !q.trim()}>
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {hits === null ? (
        <div className="empty-state-block"><p>Search approved research memory by keyword.</p></div>
      ) : hits.length === 0 ? (
        <div className="empty-state-block"><p>No lessons match “{q}”.</p></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {hits.map((h) => (
            <div key={h.id} style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--panel)", padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{h.title}</span>
                <span className="sev-badge" style={{ color: "var(--accent)", marginLeft: "auto" }}>score {h.score}</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>{h.lesson}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {h.technology_tags.map((t) => <span key={t} className="type-badge">{t}</span>)}
                {h.match_reason.map((t) => (
                  <span key={`m-${t}`} className="type-badge" style={{ color: "var(--good)", borderColor: "var(--good)" }}>⌕ {t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
