import { useEffect, useRef, useState } from "react";
import { Network, Search } from "lucide-react";
import { getApiKey } from "../../lib/api";

type SearchResult = {
  id: string;
  title: string;
  content: string;
  score: number;
  pack_id: string;
};

export default function SourceGraph() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const r = await fetch("/api/v1/knowledge/search", {
        method: "POST",
        headers,
        body: JSON.stringify({ query: q, limit: 20 }),
      });
      const data = r.ok ? await r.json() : [];
      setResults(Array.isArray(data) ? data : data.results ?? []);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }

  function scoreBar(score: number) {
    const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            flex: 1,
            height: 4,
            background: "var(--border)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: pct >= 80 ? "var(--good)" : pct >= 50 ? "var(--warn)" : "var(--info)",
              borderRadius: 2,
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace", minWidth: 36 }}>
          {pct}%
        </span>
      </div>
    );
  }

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Network size={16} />
          <span>Source Graph</span>
          {searched && !loading && <small>{results.length} results</small>}
        </div>
      </div>

      {/* Search bar */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
          display: "flex",
          gap: 10,
        }}
      >
        <input
          ref={inputRef}
          style={{
            flex: 1,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "7px 12px",
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
          }}
          placeholder="Search the knowledge base…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
        />
        <button
          className="action-btn primary"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
          onClick={handleSearch}
          disabled={!query.trim() || loading}
        >
          <Search size={13} />
          Search
        </button>
      </div>

      {/* Results area */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        {loading ? (
          <div className="page-loading">Searching…</div>
        ) : !searched ? (
          <div className="empty-state-block">
            <p>Search the knowledge base — findings, CVE patterns, technique cards.</p>
          </div>
        ) : results.length === 0 ? (
          <div className="empty-state-block">
            <p>No results for "{query}". Try different keywords.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {results.map((r) => (
              <div
                key={r.id}
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "12px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 13, color: "var(--text)" }}>{r.title}</strong>
                  <code className="type-badge">{r.pack_id}</code>
                </div>
                {scoreBar(r.score)}
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    margin: 0,
                    lineHeight: 1.6,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {r.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
