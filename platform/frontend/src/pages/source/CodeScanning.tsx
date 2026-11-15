import { useCallback, useEffect, useState } from "react";
import { GitPullRequest, Play, Download, FileCode2, ShieldAlert, Wrench } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Finding = {
  id: string; severity: string; file: string; line: number;
  detector: string; message: string; snippet: string | null;
};
type Scan = {
  id: string; repo: string; revision: string | null; pr_number: number | null;
  trigger: string; scope: string; status: string; fail_on: string; exit_code: number | null;
  summary: { counts?: Record<string, number>; total?: number }; created_at: string;
  findings?: Finding[];
};

type FixItem = {
  finding_id: string; detector: string; cwe: string | null; guidance: string;
  original_line: string | null; suggested_line: string | null; auto_fixable: boolean;
};
type FixPlan = { scan_id: string; total: number; auto_fixable: number; items: FixItem[] };

const SEV_CLASS: Record<string, string> = {
  critical: "crit", high: "high", medium: "med", low: "low",
};

function headers(): Record<string, string> {
  const key = getApiKey();
  return key
    ? { "X-Api-Key": key, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

function Gate({ scan }: { scan: Scan }) {
  if (scan.status === "running") {
    return <span className="cbx-gate idle"><span className="cbx-pulse" /> scanning</span>;
  }
  if (scan.status !== "completed") return <span className="cbx-gate idle">{scan.status}</span>;
  return scan.exit_code === 2
    ? <span className="cbx-gate fail">✗ failed</span>
    : <span className="cbx-gate pass">✓ passed</span>;
}

export default function CodeScanning() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [selected, setSelected] = useState<Scan | null>(null);
  const [fixPlan, setFixPlan] = useState<FixPlan | null>(null);
  const [loadingFixes, setLoadingFixes] = useState(false);
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

  useEffect(() => { loadScans(); }, [loadScans]);

  async function openScan(id: string) {
    setFixPlan(null);
    const resp = await fetch(`/api/v1/github/scans/${id}`, { headers: headers() });
    if (resp.ok) setSelected(await resp.json());
  }

  async function loadFixes(id: string) {
    setLoadingFixes(true);
    try {
      const resp = await fetch(`/api/v1/github/scans/${id}/fix-plan`, { headers: headers() });
      if (resp.ok) setFixPlan(await resp.json());
    } finally {
      setLoadingFixes(false);
    }
  }

  async function downloadPatch(id: string) {
    const resp = await fetch(`/api/v1/github/scans/${id}/fix.patch`, { headers: headers() });
    if (!resp.ok) return;
    const text = await resp.text();
    if (!text.trim()) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/x-patch" }));
    const a = document.createElement("a");
    a.href = url; a.download = `cyberbox-${id.slice(0, 8)}.patch`; a.click();
    URL.revokeObjectURL(url);
  }

  async function runScan() {
    if (!repo.trim()) return;
    setRunning(true); setError("");
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
    a.href = url; a.download = `cyberbox-${id.slice(0, 8)}.sarif`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="cbx-page">
      <div className="cbx-eyebrow">Repositories / code scanning</div>
      <h1 className="cbx-h1">Code Scanning</h1>
      <p className="cbx-sub">
        Diff-scoped or full-tree security scan with false-positive suppression. The gate fails
        (exit 2) at or above <code>fail_on</code>; SARIF 2.1.0 exports to GitHub code scanning.
      </p>

      {/* run bar */}
      <div className="cbx-panel" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="cbx-field" style={{ flex: "2 1 280px" }}>
            Repository (local checkout)
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="/path/to/repo" />
          </label>
          <label className="cbx-field">
            Scope
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="full">full tree</option>
              <option value="diff">diff (PR)</option>
            </select>
          </label>
          {scope === "diff" && (
            <label className="cbx-field">
              Diff base
              <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="origin/main" style={{ width: 130 }} />
            </label>
          )}
          <label className="cbx-field">
            Fail on
            <select value={failOn} onChange={(e) => setFailOn(e.target.value)}>
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </label>
          <button className="cbx-btn cbx-btn-primary" onClick={runScan} disabled={running || !repo.trim()}>
            <Play size={14} /> {running ? "Scanning…" : "Run scan"}
          </button>
        </div>
        {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 10 }}>{error}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.25fr)", gap: 20 }}>
        {/* scans list */}
        <div className="cbx-panel">
          <div className="cbx-panel-title">Recent scans</div>
          {loading ? (
            <div style={{ color: "var(--muted)" }}>Loading…</div>
          ) : scans.length === 0 ? (
            <div className="cbx-empty">
              <GitPullRequest size={28} />
              <div style={{ marginTop: 8 }}>No scans yet</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {scans.map((s) => (
                <button key={s.id} className={`cbx-row ${selected?.id === s.id ? "is-active" : ""}`}
                  onClick={() => openScan(s.id)}>
                  <span className="cbx-mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.repo.split("/").slice(-1)[0]}{s.pr_number ? ` #${s.pr_number}` : ""}
                    <span style={{ color: "var(--muted)", marginLeft: 8 }}>{s.scope}</span>
                  </span>
                  <span style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12 }}>
                    <span className="cbx-mono" style={{ color: "var(--muted)" }}>{s.summary?.total ?? 0}</span>
                    <Gate scan={s} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* detail */}
        <div className="cbx-panel">
          {!selected ? (
            <div className="cbx-empty">
              <FileCode2 size={28} />
              <div style={{ marginTop: 8 }}>Select a scan to view findings</div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <div className="cbx-mono" style={{ fontSize: 13 }}>{selected.repo}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                    {selected.scope} · <Gate scan={selected} /> · {selected.summary?.total ?? 0} finding(s)
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(selected.findings ?? []).length > 0 && (
                    <button className="cbx-btn cbx-btn-ghost" onClick={() => loadFixes(selected.id)}>
                      <Wrench size={13} /> {loadingFixes ? "…" : "Suggest fixes"}
                    </button>
                  )}
                  <button className="cbx-btn cbx-btn-ghost" onClick={() => downloadSarif(selected.id)}>
                    <Download size={13} /> SARIF
                  </button>
                </div>
              </div>

              {fixPlan && (
                <div className="cbx-panel" style={{ marginBottom: 12, background: "var(--bg)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="cbx-panel-title" style={{ margin: 0 }}>
                      Remediation · {fixPlan.auto_fixable}/{fixPlan.total} auto-fixable
                    </span>
                    {fixPlan.auto_fixable > 0 && (
                      <button className="cbx-btn cbx-btn-primary" style={{ padding: "6px 12px", fontSize: 12 }}
                        onClick={() => downloadPatch(selected.id)}>
                        <Download size={12} /> Download .patch
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
                    Suggestions only — CyberBox never edits your repo or opens a PR. Review the patch and apply it yourself.
                  </div>
                </div>
              )}
              {(selected.findings ?? []).length === 0 ? (
                <div style={{ color: "var(--good)", padding: "14px 0", fontSize: 13 }}>No findings — gate passed.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(selected.findings ?? []).map((f) => (
                    <div key={f.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <span className={`cbx-sev ${SEV_CLASS[f.severity]}`}>
                          <ShieldAlert size={11} /> {f.severity}
                        </span>
                        <span style={{ fontSize: 12.5 }}>{f.detector}</span>
                      </div>
                      <div className="cbx-mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                        {f.file}:{f.line}
                      </div>
                      {f.snippet && (
                        <pre className="cbx-mono" style={{ fontSize: 11, background: "var(--bg)", padding: "7px 9px",
                          borderRadius: 5, marginTop: 7, marginBottom: 0, overflow: "auto", color: "var(--text)",
                          border: "1px solid var(--border)" }}>
                          {f.snippet}
                        </pre>
                      )}
                      {(() => {
                        const fix = fixPlan?.items.find((i) => i.finding_id === f.id);
                        if (!fix) return null;
                        return (
                          <div style={{ marginTop: 8, borderLeft: "2px solid var(--accent)", paddingLeft: 10 }}>
                            <div style={{ fontSize: 11.5, color: "var(--text)" }}>
                              {fix.cwe && <span className="cbx-mono" style={{ color: "var(--accent)", marginRight: 6 }}>{fix.cwe}</span>}
                              {fix.guidance}
                            </div>
                            {fix.suggested_line && (
                              <pre className="cbx-mono" style={{ fontSize: 11, background: "rgba(74,222,128,0.07)",
                                padding: "7px 9px", borderRadius: 5, marginTop: 6, marginBottom: 0, overflow: "auto",
                                color: "var(--good)", border: "1px solid rgba(74,222,128,0.25)" }}>
                                + {fix.suggested_line.trim()}
                              </pre>
                            )}
                          </div>
                        );
                      })()}
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
