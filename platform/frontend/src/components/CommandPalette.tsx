import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { NAV_SECTIONS, type NavItem } from "../routes";

type IndexedItem = NavItem & { sectionLabel: string };

const ALL_ITEMS: IndexedItem[] = NAV_SECTIONS.flatMap((s) =>
  s.items.map((item) => ({ ...item, sectionLabel: s.label }))
);

function fuzzy(query: string, text: string): boolean {
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) { if (t[i] === q[qi]) qi++; }
  return qi === q.length;
}

interface Props { open: boolean; onClose: () => void }

export function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const results = query
    ? ALL_ITEMS.filter((item) => fuzzy(query, item.label) || fuzzy(query, item.sectionLabel))
    : ALL_ITEMS.slice(0, 10);

  useEffect(() => {
    if (open) { setQuery(""); setActiveIndex(0); requestAnimationFrame(() => inputRef.current?.focus()); }
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[activeIndex]) { navigate(results[activeIndex].path); onClose(); }
    else if (e.key === "Escape") { onClose(); }
  }

  if (!open) return null;

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-shell" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-label="Command palette" aria-modal="true">
        <div className="palette-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Navigate to…"
            role="combobox"
            aria-expanded="true"
          />
          <kbd className="palette-esc">Esc</kbd>
        </div>
        <ul className="palette-results" role="listbox">
          {results.map((item, i) => (
            <li key={item.path} role="option" aria-selected={i === activeIndex}
              className={`palette-result-item${i === activeIndex ? " active" : ""}`}
              onClick={() => { navigate(item.path); onClose(); }}>
              <item.Icon size={14} />
              <span className="palette-result-label">{item.label}</span>
              <span className="palette-result-section">{item.sectionLabel}</span>
              <code className="palette-result-path">{item.path}</code>
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty">No results for "{query}"</li>}
        </ul>
      </div>
    </div>
  );
}
