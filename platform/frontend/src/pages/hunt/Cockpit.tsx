import { useEffect, useMemo, useState } from "react";
import {
  LayoutGrid, Link2, Plug, X as XIcon, ShieldCheck, ShieldAlert, Search,
  CircleDot, CheckCircle2, Circle, RefreshCw,
} from "lucide-react";
import {
  fetchProjects, fetchTaxonomyFamilies, fetchProjectCoverage, fetchProjectChains,
  fetchEngines, setCoverage,
  type TaxFamily, type CoverageClass, type CoverageResponse, type Chain, type Engine,
} from "../../lib/api";

// Payout "heat" ramp — acid-yellow family; brighter = more money once dupe/triage drift is priced in.
const PAYOUT_COLOR: Record<number, string> = {
  1: "#3b4026", 2: "#6b7312", 3: "#9aa600", 4: "#c3d400", 5: "#e8fa1a",
};
const PRIORITY_COLOR: Record<string, string> = {
  P1: "var(--bad)", P2: "#ff8c42", P3: "var(--warn)", P4: "var(--info)", P5: "var(--muted)",
};
const STATUS_BG: Record<string, string> = {
  covered: "rgba(44,224,126,0.12)", partial: "rgba(224,176,44,0.12)", none: "var(--panel)",
};
const STATUS_BORDER: Record<string, string> = {
  covered: "var(--good)", partial: "var(--warn)", none: "var(--border)",
};

function dollars(rank: number): string { return "$".repeat(Math.max(1, Math.min(5, rank))); }

export default function Cockpit() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [families, setFamilies] = useState<TaxFamily[]>([]);
  const [cov, setCov] = useState<CoverageResponse | null>(null);
  const [chains, setChains] = useState<Chain[]>([]);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CoverageClass | null>(null);
  const [toast, setToast] = useState("");

  // filters
  const [q, setQ] = useState("");
  const [uncoveredOnly, setUncoveredOnly] = useState(false);
  const [moneyOnly, setMoneyOnly] = useState(false);
  const [fuelOnly, setFuelOnly] = useState(false);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(""), 3000); }

  async function loadProject(pid: string) {
    const [c, ch] = await Promise.all([fetchProjectCoverage(pid), fetchProjectChains(pid)]);
    setCov(c);
    setChains(ch);
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true);
      const [projs, fams, engs] = await Promise.all([
        fetchProjects(), fetchTaxonomyFamilies(), fetchEngines(),
      ]);
      if (dead) return;
      setProjects(projs);
      setFamilies(fams);
      setEngines(engs);
      const pid = projs[0]?.id ?? "";
      setProjectId(pid);
      if (pid) await loadProject(pid);
      setLoading(false);
    })();
    return () => { dead = true; };
  }, []);

  async function changeProject(pid: string) {
    setProjectId(pid); setSelected(null); setLoading(true);
    await loadProject(pid); setLoading(false);
  }

  async function mark(cls: CoverageClass, status: "none" | "partial" | "covered") {
    try {
      await setCoverage(projectId, cls.id, status, cls.evidence_ids, cls.note); // preserve engine evidence
      flash(`${cls.name} → ${status}`);
      await loadProject(projectId);
      setSelected({ ...cls, status });
    } catch (e) {
      flash(e instanceof Error ? e.message : "update failed");
    }
  }

  const classes = cov?.classes ?? [];
  const famName = useMemo(() => Object.fromEntries(families.map((f) => [f.num, f.name])), [families]);
  const famMoney = useMemo(() => Object.fromEntries(families.map((f) => [f.num, f.money_rank])), [families]);

  const filtered = useMemo(() => classes.filter((c) => {
    if (uncoveredOnly && c.status === "covered") return false;
    if (moneyOnly && c.payout_rank < 4) return false;
    if (fuelOnly && !c.chain_component) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!c.name.toLowerCase().includes(s) && !(c.cwe ?? "").toLowerCase().includes(s)
          && !(c.signal ?? "").toLowerCase().includes(s)) return false;
    }
    return true;
  }), [classes, uncoveredOnly, moneyOnly, fuelOnly, q]);

  const byFamily = useMemo(() => {
    const m = new Map<number, CoverageClass[]>();
    for (const c of filtered) { (m.get(c.family_num) ?? m.set(c.family_num, []).get(c.family_num)!).push(c); }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  const summary = cov?.summary;
  const covered = summary?.by_status.covered ?? 0;
  const partial = summary?.by_status.partial ?? 0;
  const total = summary?.total ?? 0;
  const untouched = total - covered - partial;
  const pct = total ? Math.round((covered / total) * 100) : 0;
  const readyChains = chains.filter((c) => c.ready);
  const leadChains = chains.filter((c) => !c.ready);

  // chains this selected class feeds
  const selectedFeeds = useMemo(() => !selected ? [] :
    chains.filter((ch) => ch.components.some((k) => k.class_id === selected.id)), [chains, selected]);

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <LayoutGrid size={16} />
          <span>Methodology Cockpit</span>
          <small>{total} classes · {families.length} families</small>
        </div>
        <div className="toolbar-actions">
          {projects.length > 1 && (
            <select className="action-btn" value={projectId} onChange={(e) => changeProject(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="filter-input-wrap">
            <Search size={13} />
            <input placeholder="Search class / CWE / signal…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="action-btn" style={uncoveredOnly ? activeStyle("var(--info)") : {}} onClick={() => setUncoveredOnly((v) => !v)}>Uncovered</button>
          <button className="action-btn" style={moneyOnly ? activeStyle("var(--accent)") : {}} onClick={() => setMoneyOnly((v) => !v)}>$$$$+</button>
          <button className="action-btn" style={fuelOnly ? activeStyle("var(--warn)") : {}} onClick={() => setFuelOnly((v) => !v)}>Chain fuel</button>
          <button className="action-btn" onClick={() => projectId && changeProject(projectId)} title="Refresh"><RefreshCw size={13} /></button>
        </div>
      </div>

      {/* stat tiles */}
      <div style={{ display: "flex", gap: 1, borderBottom: "1px solid var(--border)", background: "var(--border)", flexShrink: 0 }}>
        {[
          { label: "Covered", val: covered, color: "var(--good)" },
          { label: "Partial", val: partial, color: "var(--warn)" },
          { label: "Untouched", val: untouched, color: "var(--muted)" },
          { label: "Coverage", val: `${pct}%`, color: pct > 0 ? "var(--accent)" : "var(--muted)" },
          { label: "Ready chains", val: readyChains.length, color: readyChains.length ? "var(--bad)" : "var(--muted)" },
          { label: "Leads", val: leadChains.length, color: leadChains.length ? "var(--info)" : "var(--muted)" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ flex: 1, background: "var(--panel)", padding: "8px 16px" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>{val}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="page-loading">Loading cockpit…</div>
      ) : !projectId ? (
        <div className="empty-state-block"><p>No project loaded. Create a pentest to start tracking coverage.</p></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 0, flex: 1, minHeight: 0 }}>
          {/* ── Coverage board ── */}
          <div style={{ overflowY: "auto", padding: "12px 14px", borderRight: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, fontSize: 10, color: "var(--muted)", flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><CheckCircle2 size={12} style={{ color: "var(--good)" }} /> covered</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><CircleDot size={12} style={{ color: "var(--warn)" }} /> partial</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Circle size={12} style={{ color: "var(--muted)" }} /> untouched</span>
              <span style={{ marginLeft: 8 }}>payout heat:</span>
              {[1, 2, 3, 4, 5].map((r) => <span key={r} style={{ width: 16, height: 10, background: PAYOUT_COLOR[r], borderRadius: 2 }} title={dollars(r)} />)}
            </div>

            {byFamily.length === 0 ? (
              <div className="empty-state-block"><p>No classes match the filter.</p></div>
            ) : byFamily.map(([fnum, cls]) => {
              const fcov = cls.filter((c) => c.status === "covered").length;
              return (
                <div key={fnum} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>{String(fnum).padStart(2, "0")}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{famName[fnum] ?? `Family ${fnum}`}</span>
                    {famMoney[fnum] != null && (
                      <span className="type-badge" style={{ color: "var(--accent)", borderColor: "var(--accent)" }} title="top-money family rank">money #{famMoney[fnum]}</span>
                    )}
                    <span style={{ fontSize: 10, color: fcov ? "var(--good)" : "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>{fcov}/{cls.length}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 5 }}>
                    {cls.map((c) => (
                      <button key={c.id} onClick={() => setSelected(c)} title={c.signal ?? c.name}
                        style={{
                          textAlign: "left", cursor: "pointer", padding: "6px 8px", borderRadius: 4,
                          background: STATUS_BG[c.status], border: `1px solid ${STATUS_BORDER[c.status]}`,
                          borderLeft: `3px solid ${PAYOUT_COLOR[c.payout_rank]}`,
                          outline: selected?.id === c.id ? "1px solid var(--accent)" : "none",
                        }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 4, alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: PRIORITY_COLOR[c.priority.split("-")[0]] ?? "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>{c.priority}</span>
                          <span style={{ fontSize: 9, color: PAYOUT_COLOR[c.payout_rank], fontFamily: "'JetBrains Mono', monospace" }}>{dollars(c.payout_rank)}</span>
                          {c.informational_only === 1 && <span style={{ fontSize: 9, color: "var(--muted)" }}>info</span>}
                          {c.evidence_ids.length > 0 && <span style={{ fontSize: 9, color: "var(--good)" }}>●{c.evidence_ids.length}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Right rail: chains + engines ── */}
          <div style={{ overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 18 }}>
            <section>
              <h3 style={railHead}><Link2 size={13} /> Chain escalation</h3>
              {chains.length === 0 ? (
                <p style={railMuted}>Cover a class to surface the chains it unlocks. Chains only show as <b>ready</b> when every mapped component is covered — never from a shared keyword.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...readyChains, ...leadChains].map((ch) => (
                    <div key={ch.id} style={{
                      padding: "8px 10px", borderRadius: 5, background: "var(--panel)",
                      border: `1px solid ${ch.ready ? "var(--bad)" : "var(--border)"}`,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>{ch.name}</span>
                        <span className="sev-badge" style={{ color: ch.ready ? "var(--bad)" : "var(--info)", flexShrink: 0 }}>{ch.ready ? "READY" : `${ch.have}/${ch.total}`}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>→ {ch.result_impact} <span style={{ color: PRIORITY_COLOR[ch.result_priority] ?? "var(--muted)" }}>({ch.result_priority})</span></div>
                      {ch.missing.length > 0 && (
                        <div style={{ fontSize: 10, color: "var(--warn)", marginTop: 3 }}>need: {ch.missing.join("; ")}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 style={railHead}><Plug size={13} /> Engines</h3>
              <p style={{ ...railMuted, marginBottom: 8 }}>Tools that auto-mark coverage from real evidence. Findings flip classes; the ledger stays the product.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {engines.map((e) => (
                  <div key={e.key} style={{ padding: "7px 10px", borderRadius: 5, background: "var(--panel)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>{e.name}</span>
                      <span className="type-badge">{e.optional ? "optional" : e.kind}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>feeds <span style={{ color: "var(--accent)", fontFamily: "'JetBrains Mono', monospace" }}>{e.covers_count}</span> classes</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {selected && (
        <ClassDrawer
          cls={selected}
          feeds={selectedFeeds}
          onClose={() => setSelected(null)}
          onMark={mark}
        />
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

function ClassDrawer({ cls, feeds, onClose, onMark }: {
  cls: CoverageClass; feeds: Chain[];
  onClose: () => void; onMark: (c: CoverageClass, s: "none" | "partial" | "covered") => void;
}) {
  const reportable = cls.informational_only !== 1;
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: "min(520px, 100%)" }}>
        <div className="modal-header">
          <h2 style={{ fontSize: 14 }}>{cls.name}</h2>
          <button onClick={onClose}><XIcon size={16} /></button>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="sev-badge" style={{ color: PRIORITY_COLOR[cls.priority.split("-")[0]] ?? "var(--muted)" }}>{cls.priority}</span>
            <span style={{ fontSize: 12, color: PAYOUT_COLOR[cls.payout_rank], fontFamily: "'JetBrains Mono', monospace" }}>{dollars(cls.payout_rank)} payout</span>
            {cls.cwe && <span className="type-badge">{cls.cwe}</span>}
            {cls.chain_component === 1 && <span className="type-badge" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>chain fuel</span>}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
            {reportable
              ? <><ShieldCheck size={14} style={{ color: "var(--good)" }} /><span style={{ color: "var(--good)" }}>Reportable standalone when demonstrated</span></>
              : <><ShieldAlert size={14} style={{ color: "var(--warn)" }} /><span style={{ color: "var(--warn)" }}>Informational — report only inside a chain</span></>}
          </div>

          {cls.signal && (
            <div>
              <div style={labelStyle}>Signal</div>
              <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>{cls.signal}</div>
            </div>
          )}

          {feeds.length > 0 && (
            <div>
              <div style={labelStyle}>Feeds {feeds.length} chain{feeds.length === 1 ? "" : "s"}</div>
              {feeds.map((f) => (
                <div key={f.id} style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  → {f.name} <span style={{ color: PRIORITY_COLOR[f.result_priority] ?? "var(--muted)" }}>({f.result_priority})</span>
                </div>
              ))}
            </div>
          )}

          {cls.evidence_ids.length > 0 && (
            <div>
              <div style={labelStyle}>Evidence ({cls.evidence_ids.length})</div>
              {cls.note && <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 3 }}>{cls.note}</div>}
              {cls.evidence_ids.map((id) => (
                <code key={id} style={{ display: "block", fontSize: 10, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>{id}</code>
              ))}
            </div>
          )}

          <div>
            <div style={labelStyle}>Coverage on this target</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              {(["none", "partial", "covered"] as const).map((s) => (
                <button key={s} className="action-btn"
                  style={cls.status === s ? activeStyle(STATUS_BORDER[s]) : {}}
                  onClick={() => onMark(cls, s)}>{s}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const railHead: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, fontSize: 11, textTransform: "uppercase",
  letterSpacing: "0.08em", color: "var(--muted)", margin: "0 0 8px 0",
};
const railMuted: React.CSSProperties = { fontSize: 10, color: "var(--muted)", lineHeight: 1.5, margin: 0 };
const labelStyle: React.CSSProperties = {
  fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 2,
};
function activeStyle(color: string): React.CSSProperties { return { color, borderColor: color }; }
