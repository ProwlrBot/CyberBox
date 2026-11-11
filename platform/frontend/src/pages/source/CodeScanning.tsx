import { useCallback, useEffect, useState } from "react";
import { GitPullRequest, Play, Download, FileCode2, ShieldAlert } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Finding = {
  id: string;
  severity: string;
  file: string;
  line: number;
  detector: string;
  message: string;
  snippet: string | null;
};

type Scan = {
  id: string;
  repo: string;
  revision: string | null;
  base_revision: string | null;
  pr_number: number | null;
  trigger: string;
  scope: string;
  status: string;
  fail_on: string;
  exit_code: number | null;
  summary: { counts?: Record<string, number>; total?: number };
  created_at: string;
  findings?: Finding[];
};

const SEV_COLOR: Record<string, string> = {
  critical: "var(--bad)",
  high: "var(--red, var(--bad))",
  medium: "var(--warn)",
  low: "var(--info)",
};

function headers(): Record<string, string> {
  const key = getApiKey();
  return key ? { "X-Api-Key": key, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function Gate({ scan }: { scan: Scan }) {
  if (scan.status !== "completed") {
    return <span style={{ color: "var(--muted)" }}>{scan.status}</span>;
  }
  const failed = scan.exit_code === 2;
  return (
    <span style={{ color: failed ? "var(--bad)" : "var(--good)", fontWeight: 600 }}>
      {failed ? "✗ failed" : "✓ passed"}
    </span>
  );
}

export default function CodeScanning() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [selected, setSelected] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(true);
  const [repo, setRepo] = useState("");
  const [scope, setScope] = useState("full");
  const [base, setBase] = useState("");
  const [failOn, setFailOn] = useState("high");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const loadScans = useCallback(async () => {
    try {
      const resp = await fetch("/api/v1/github/scans", { headers: headers() });
      if (!resp.ok) throw new Error(`${resp.status}`);
      setScans(await resp.json());
    } catch (e) {
      setError(`Could not load scans: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScans();
  }, [loadScans]);

  async function openScan(id: string) {
    const resp = await fetch(`/api/v1/github/scans/${id}`, { headers: headers() });
    if (resp.ok) setSelected(await resp.json());
  }

  async function runScan() {
    if (!repo.trim()) return;
    setRunning(true);
    setError("");
    try {
      const body: Record<string, unknown> = { repo: repo.trim(), scope, fail_on: failOn };
      if (scope === "diff" && base.trim()) body.base = base.trim();
      const resp = await fetch("/api/v1/github/scan", {
        method: "POST", headers: headers(), body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw new Error(detail.detail || `${resp.status}`);
      }
      const scan = await resp.json();
      await loadScans();
      setSelected(scan);
    } catch (e) {
      setError(`Scan failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  async function downloadSarif(id: string) {
    const resp = await fetch(`/api/v1/github/scans/${id}/sarif`, { headers: headers() });
    if (!resp.ok) return;
    const data = await resp.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cyberbox-${id.slice(0, 8)}.sarif`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const card: React.CSSProperties = {
    background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 16,
  };

  return (
    <div style={{ padding: 24, color: "var(--text)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <GitPullRequest size={20} />
        <h1 style={{ margin: 0, fontSize: 20 }}>Code Scanning</h1>
      </div>
      <p style={{ color: "var(--muted)", marginTop: 4, marginBottom: 20, fontSize: 13 }}>
        Diff-scoped or full-tree security scan of a repo. Exit code 2 fails the CI gate at or
        above the <code>fail_on</code> severity. SARIF 2.1.0 exportable to GitHub code scanning.
      </p>

      {/* run form */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ flex: "2 1 280px", fontSize: 12, color: "var(--muted)" }}>
            Repository (local checkout path)
            <input value={repo} onChange={(e) => setRepo(e.target.value)}
              placeholder="/path/to/repo"
              style={{ width: "100%", marginTop: 4, padding: "8px 10px", background: "var(--bg)",
                border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)" }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            Scope
            <select value={scope} onChange={(e) => setScope(e.target.value)}
              style={{ display: "block", marginTop: 4, padding: "8px 10px", background: "var(--bg)",
                border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)" }}>
              <option value="full">full tree</option>
              <option value="diff">diff (PR)</option>
            </select>
          </label>
          {scope === "diff" && (
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              Diff base
              <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="origin/main"
                style={{ display: "block", marginTop: 4, padding: "8px 10px", background: "var(--bg)",
                  border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", width: 130 }} />
            </label>
          )}
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            Fail on
            <select value={failOn} onChange={(e) => setFailOn(e.target.value)}
              style={{ display: "block", marginTop: 4, padding: "8px 10px", background: "var(--bg)",
                border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)" }}>
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </label>
          <button onClick={runScan} disabled={running || !repo.trim()}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px",
              background: "var(--accent)", color: "var(--bg)", border: "none", borderRadius: 6,
              fontWeight: 600, cursor: running ? "wait" : "pointer", opacity: running ? 0.6 : 1 }}>
            <Play size={14} /> {running ? "Scanning…" : "Run scan"}
          </button>
        </div>
        {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 10 }}>{error}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", gap: 20 }}>
        {/* scans list */}
        <div style={card}>
          <h2 style={{ fontSize: 14, marginTop: 0, marginBottom: 12, color: "var(--muted)" }}>Recent scans</h2>
          {loading ? (
            <div style={{ color: "var(--muted)" }}>Loading…</div>
          ) : scans.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "32px 0" }}>
              <GitPullRequest size={28} style={{ opacity: 0.4 }} />
              <div style={{ marginTop: 8 }}>No scans yet</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {scans.map((s) => (
                <button key={s.id} onClick={() => openScan(s.id)}
                  style={{ textAlign: "left", background: selected?.id === s.id ? "var(--surface)" : "transparent",
                    border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)",
                    cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "monospace", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.repo.split("/").slice(-1)[0]}
                    {s.pr_number ? ` #${s.pr_number}` : ""}
                    <span style={{ color: "var(--muted)", marginLeft: 8 }}>{s.scope}</span>
                  </span>
                  <span style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12 }}>
                    <span style={{ color: "var(--muted)" }}>{s.summary?.total ?? 0}</span>
                    <Gate scan={s} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* findings detail */}
        <div style={card}>
          {!selected ? (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "48px 0" }}>
              <FileCode2 size={28} style={{ opacity: 0.4 }} />
              <div style={{ marginTop: 8 }}>Select a scan to view findings</div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: 13 }}>{selected.repo}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {selected.scope} · gate <Gate scan={selected} /> · {selected.summary?.total ?? 0} finding(s)
                  </div>
                </div>
                <button onClick={() => downloadSarif(selected.id)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                    background: "transparent", color: "var(--text)", border: "1px solid var(--border)",
                    borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                  <Download size={13} /> SARIF
                </button>
              </div>
              {(selected.findings ?? []).length === 0 ? (
                <div style={{ color: "var(--good)", padding: "16px 0" }}>No findings — gate passed.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(selected.findings ?? []).map((f) => (
                    <div key={f.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <ShieldAlert size={13} style={{ color: SEV_COLOR[f.severity] }} />
                        <span style={{ color: SEV_COLOR[f.severity], fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>
                          {f.severity}
                        </span>
                        <span style={{ fontSize: 12 }}>{f.detector}</span>
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                        {f.file}:{f.line}
                      </div>
                      {f.snippet && (
                        <pre style={{ fontFamily: "monospace", fontSize: 11, background: "var(--bg)", padding: "6px 8px",
                          borderRadius: 4, marginTop: 6, marginBottom: 0, overflow: "auto", color: "var(--text)" }}>
                          {f.snippet}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
