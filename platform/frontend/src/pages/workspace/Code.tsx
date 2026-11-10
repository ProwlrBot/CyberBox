import { useCallback, useEffect, useRef, useState } from "react";
import { FileCode2, Save, Trash2, Plus, Copy } from "lucide-react";

type Snippet = { id: string; title: string; lang: string; body: string; created_at: string; note: string; };

const LANGS = ["html", "javascript", "python", "bash", "json", "yaml", "php", "ruby", "java", "text"];
const STORAGE_KEY = "cbx.code.snippets";

function loadSnippets(): Snippet[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Snippet[]; }
  catch { return []; }
}

function saveSnippets(snips: Snippet[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snips));
}

export default function CodePage() {
  const [snippets, setSnippets] = useState<Snippet[]>(loadSnippets);
  const [activeId, setActiveId] = useState<string | null>(() => loadSnippets()[0]?.id ?? null);
  const [editTitle, setEditTitle] = useState("");
  const [editLang, setEditLang] = useState("javascript");
  const [editBody, setEditBody] = useState("");
  const [editNote, setEditNote] = useState("");
  const [unsaved, setUnsaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeId) { setEditTitle(""); setEditBody(""); setEditNote(""); setUnsaved(false); return; }
    const snip = snippets.find((s) => s.id === activeId);
    if (snip) { setEditTitle(snip.title); setEditLang(snip.lang); setEditBody(snip.body); setEditNote(snip.note); setUnsaved(false); }
  }, [activeId]);

  function newSnippet() {
    const snip: Snippet = {
      id: String(Date.now()),
      title: "Untitled",
      lang: "javascript",
      body: "",
      created_at: new Date().toISOString(),
      note: "",
    };
    const updated = [snip, ...snippets];
    setSnippets(updated);
    saveSnippets(updated);
    setActiveId(snip.id);
  }

  function saveActive() {
    if (!activeId) return;
    const updated = snippets.map((s) =>
      s.id === activeId ? { ...s, title: editTitle, lang: editLang, body: editBody, note: editNote } : s
    );
    setSnippets(updated);
    saveSnippets(updated);
    setUnsaved(false);
  }

  function deleteSnippet(id: string) {
    const updated = snippets.filter((s) => s.id !== id);
    setSnippets(updated);
    saveSnippets(updated);
    if (activeId === id) setActiveId(updated[0]?.id ?? null);
  }

  function copyBody() {
    navigator.clipboard.writeText(editBody).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const onBodyChange = useCallback((v: string) => {
    setEditBody(v);
    setUnsaved(true);
  }, []);

  const onNoteChange = useCallback((v: string) => {
    setEditNote(v);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      if (!activeId) return;
      setSnippets((prev) => {
        const updated = prev.map((s) => s.id === activeId ? { ...s, note: v } : s);
        saveSnippets(updated);
        return updated;
      });
    }, 500);
  }, [activeId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveActive();
    }
  }

  if (snippets.length === 0 && !activeId) {
    return (
      <div className="page-targets">
        <div className="page-toolbar">
          <div className="page-title"><FileCode2 size={16} /><span>Code</span></div>
          <div className="toolbar-actions">
            <button className="action-btn primary" onClick={newSnippet}><Plus size={13} /> New Snippet</button>
          </div>
        </div>
        <div className="empty-state-block" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <p>No snippets yet — click <strong>+ New Snippet</strong> to start.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="page-toolbar" style={{ flexShrink: 0 }}>
        <div className="page-title"><FileCode2 size={16} /><span>Code</span><small>{snippets.length} snippets</small></div>
        <div className="toolbar-actions">
          <button className="action-btn primary" onClick={newSnippet}><Plus size={13} /> New</button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left sidebar */}
        <div style={{ width: 200, borderRight: "1px solid var(--border)", overflowY: "auto", background: "var(--panel)", flexShrink: 0 }}>
          {snippets.map((snip) => (
            <div
              key={snip.id}
              onClick={() => setActiveId(snip.id)}
              style={{
                padding: "9px 12px",
                cursor: "pointer",
                borderBottom: "1px solid var(--border)",
                borderLeft: activeId === snip.id ? "2px solid var(--accent)" : "2px solid transparent",
                background: activeId === snip.id ? "var(--panel-2)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 4,
              }}
              className="snippet-row"
            >
              <span style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {snip.title || "Untitled"}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteSnippet(snip.id); }}
                style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "0 2px", fontSize: 14, lineHeight: 1, flexShrink: 0 }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>

        {/* Editor */}
        {activeId ? (
          <>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Editor toolbar */}
              <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <input
                  value={editTitle}
                  onChange={(e) => { setEditTitle(e.target.value); setUnsaved(true); }}
                  style={{ flex: 1, background: "none", border: "none", color: "var(--text)", fontSize: 14, fontWeight: 600, fontFamily: "inherit", outline: "none" }}
                  placeholder="Snippet title"
                />
                <select
                  value={editLang}
                  onChange={(e) => { setEditLang(e.target.value); setUnsaved(true); }}
                  style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)", padding: "3px 6px", borderRadius: 3, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", outline: "none" }}
                >
                  {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                {unsaved && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} title="Unsaved changes" />}
                <button className="action-btn" onClick={copyBody}><Copy size={11} />{copied ? " Copied" : " Copy"}</button>
                <button className="action-btn primary" disabled={!unsaved} onClick={saveActive}><Save size={11} /> Save</button>
              </div>
              <textarea
                value={editBody}
                onChange={(e) => onBodyChange(e.target.value)}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                style={{
                  flex: 1, resize: "none", outline: "none", border: "none",
                  background: "var(--bg)", color: "var(--text)",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                  padding: 12, lineHeight: 1.6,
                }}
                placeholder="// Paste code or notes here…"
              />
            </div>

            {/* Notes panel */}
            <div style={{ width: 240, borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", background: "var(--panel)", flexShrink: 0 }}>
              <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>
                Notes
              </div>
              <textarea
                value={editNote}
                onChange={(e) => onNoteChange(e.target.value)}
                spellCheck={false}
                placeholder="Hunt notes for this snippet…"
                style={{
                  flex: 1, resize: "none", outline: "none", border: "none",
                  background: "transparent", color: "var(--text)",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  padding: 12, lineHeight: 1.6,
                }}
              />
            </div>
          </>
        ) : (
          <div className="empty-state-block" style={{ flex: 1 }}>
            <p>Select a snippet or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
