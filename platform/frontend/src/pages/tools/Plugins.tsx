import { useEffect, useState } from "react";
import { Plug, RefreshCw, CheckCircle2, Circle } from "lucide-react";
import { getApiKey } from "../../lib/api";

type KnowledgePack = {
  id: string;
  name: string;
  version: string;
  description: string;
  kind: string;
  size?: number;
};

const BB_TOOLS = [
  { name: "nuclei",    purpose: "Template-based scanner",    cmd: "nuclei -version" },
  { name: "subfinder", purpose: "Subdomain enumeration",     cmd: "subfinder -version" },
  { name: "httpx",     purpose: "HTTP probe & fingerprint",  cmd: "httpx -version" },
  { name: "katana",    purpose: "JS-aware crawler",          cmd: "katana -version" },
  { name: "gitleaks",  purpose: "Secret scanner",            cmd: "gitleaks version" },
  { name: "trufflehog",purpose: "Credential scanner",        cmd: "trufflehog --version" },
  { name: "ffuf",      purpose: "Web fuzzer",                cmd: "ffuf -V" },
  { name: "dalfox",    purpose: "XSS scanner",               cmd: "dalfox version" },
  { name: "ghauri",    purpose: "SQL injection scanner",     cmd: "ghauri --version" },
  { name: "raptor",    purpose: "Source code scanner",       cmd: "raptor --version" },
];

function formatSize(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export default function Plugins() {
  const [packs, setPacks] = useState<KnowledgePack[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [checkedTools, setCheckedTools] = useState<Record<string, "ok" | "missing" | "checking">>({});

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

    async function fetchData() {
      try {
        const r = await fetch("/api/v1/knowledge/packs", { headers });
        const data: KnowledgePack[] = r.ok ? await r.json() : [];
        if (!cancelled) { setPacks(Array.isArray(data) ? data : []); }
      } catch {
        // keep empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  async function checkTool(name: string) {
    setCheckedTools((prev) => ({ ...prev, [name]: "checking" }));
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
    try {
      // Try to run the check via executions
      const r = await fetch("/api/v1/projects", { headers });
      const projs = r.ok ? await r.json() : [];
      const pid: string = projs[0]?.id ?? "";
      if (!pid) { setCheckedTools((prev) => ({ ...prev, [name]: "missing" })); return; }
      // We use a raptor scan to check for the tool
      const res = await fetch(`/api/v1/projects/${pid}/raptor-scan`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ protocol: "js", target_path: `/usr/local/bin/${name}`, output_format: "jsonl" }),
      });
      setCheckedTools((prev) => ({ ...prev, [name]: res.ok ? "ok" : "missing" }));
      showToast(res.ok ? `${name} is available` : `${name} not found — install it in the sandbox`);
    } catch {
      setCheckedTools((prev) => ({ ...prev, [name]: "missing" }));
      showToast(`${name}: check failed`);
    }
  }

  const filtered = packs.filter((p) =>
    filter === "" ||
    p.name.toLowerCase().includes(filter.toLowerCase()) ||
    p.description?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="page-targets">
      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: "var(--panel-2)", border: "1px solid var(--accent)",
          color: "var(--accent)", padding: "10px 16px", borderRadius: 6,
          fontFamily: "JetBrains Mono, monospace", fontSize: 12,
        }}>
          {toast}
        </div>
      )}

      <div className="page-toolbar">
        <div className="page-title">
          <Plug size={16} />
          <span>Plugin Center</span>
          <small>{packs.length} packs</small>
        </div>
        <div className="toolbar-actions">
          <div className="filter-input-wrap">
            <input
              placeholder="Filter packs…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                background: "var(--panel-2)", border: "1px solid var(--border)",
                color: "var(--text)", padding: "6px 10px", borderRadius: 4,
                fontSize: 12, fontFamily: "inherit", width: 220,
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

        {/* Knowledge Packs */}
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--muted)",
          marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
        }}>
          Installed Knowledge Packs
        </div>

        {loading ? (
          <div className="page-loading">Loading packs…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state-block">
            <p>{filter ? "No packs match filter." : "No knowledge packs loaded."}</p>
          </div>
        ) : (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
            gap: 14, marginBottom: 36,
          }}>
            {filtered.map((pack) => (
              <div key={pack.id} style={{
                background: "var(--panel)", border: "1px solid var(--border)",
                borderRadius: 6, padding: "16px 18px",
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{pack.name}</span>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <code className="type-badge" style={{ color: "var(--info)", borderColor: "var(--info)" }}>
                      v{pack.version}
                    </code>
                    <code className="type-badge">{pack.kind}</code>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.55, margin: 0 }}>
                  {pack.description || "No description available."}
                </p>
                <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "JetBrains Mono, monospace" }}>
                  {formatSize(pack.size)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Available Bug Bounty Tools */}
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--muted)",
          marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
          borderTop: "1px solid var(--border)", paddingTop: 24,
        }}>
          Bug Bounty Toolkit
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Purpose</th>
                <th>Status</th>
                <th>Install</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {BB_TOOLS.map((tool) => {
                const status = checkedTools[tool.name];
                return (
                  <tr key={tool.name} className="data-row">
                    <td>
                      <code className="mono-cell" style={{ color: "var(--accent)", fontWeight: 600 }}>
                        {tool.name}
                      </code>
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{tool.purpose}</td>
                    <td>
                      {status === "ok" ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--good)", fontSize: 12 }}>
                          <CheckCircle2 size={12} /> available
                        </span>
                      ) : status === "missing" ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--bad)", fontSize: 12 }}>
                          <Circle size={12} /> not found
                        </span>
                      ) : status === "checking" ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--warn)", fontSize: 12 }}>
                          <RefreshCw size={12} /> checking…
                        </span>
                      ) : (
                        <span className="muted-cell">—</span>
                      )}
                    </td>
                    <td>
                      <code className="mono-cell" style={{ fontSize: 10, color: "var(--muted)" }}>
                        {tool.cmd}
                      </code>
                    </td>
                    <td>
                      <button
                        className="action-btn"
                        onClick={() => checkTool(tool.name)}
                        disabled={status === "checking"}
                        style={{ fontSize: 11 }}
                      >
                        Check
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{
          marginTop: 16, padding: "12px 16px",
          background: "var(--panel)", border: "1px solid var(--border)",
          borderRadius: 6, fontSize: 12, color: "var(--muted)",
        }}>
          <strong style={{ color: "var(--text)" }}>Install tools in sandbox:</strong>{" "}
          Run <code style={{ color: "var(--accent)", fontFamily: "JetBrains Mono, monospace" }}>
            sh cybersandbox/scripts/install-malware-tools.sh
          </code> to provision the full offensive toolkit.
        </div>
      </div>
    </div>
  );
}
