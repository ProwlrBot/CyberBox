import { useEffect, useMemo, useState } from "react";
import {
  LayoutGrid, Link2, Plug, X as XIcon, ShieldCheck, ShieldAlert, Search,
  CircleDot, CheckCircle2, Circle, RefreshCw, ListChecks, Sparkles,
} from "lucide-react";
import {
  fetchProjects, fetchTaxonomyFamilies, fetchProjectCoverage, fetchProjectChains,
  fetchEngines, setCoverage, fetchMethodology, fetchEngagements, setEngagementAutonomy,
  fetchMarketByClass,
  type TaxFamily, type CoverageClass, type CoverageResponse, type Chain, type Engine,
  type Methodology, type MarketClass,
} from "../../lib/api";
import type { EngagementSummary } from "../../types";

// Autonomy dial — manual (guided) ↔ AI (autonomous). Scope/authorization gate is
// unchanged by this; even AI mode still passes policy.evaluate() per live action.
const AUTONOMY = [
  { key: "guided" as const,     label: "Manual",   hint: "approve every live action", color: "var(--info)" },
  { key: "balanced" as const,   label: "Balanced", hint: "low-risk passive runs auto", color: "var(--warn)" },
  { key: "autonomous" as const, label: "AI",       hint: "orchestrator acts to its ceiling", color: "var(--accent)" },
];

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
// Real disclosed bounty $ (market-validated), compact.
function money(n: number | null | undefined): string {
  if (!n) return "—";
  return n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n}`;
}

export default function Cockpit() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [families, setFamilies] = useState<TaxFamily[]>([]);
  const [cov, setCov] = useState<CoverageResponse | null>(null);
  const [chains, setChains] = useState<Chain[]>([]);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [market, setMarket] = useState<Map<string, MarketClass>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CoverageClass | null>(null);
  const [engagement, setEngagement] = useState<EngagementSummary | null>(null);
  const [toast, setToast] = useState("");

  // filters
  const [q, setQ] = useState("");
  const [uncoveredOnly, setUncoveredOnly] = useState(false);
  const [moneyOnly, setMoneyOnly] = useState(false);
  const [fuelOnly, setFuelOnly] = useState(false);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(""), 3000); }

  async function loadProject(pid: string) {
    const [c, ch, engs] = await Promise.all([
      fetchProjectCoverage(pid), fetchProjectChains(pid), fetchEngagements(pid),
    ]);
    setCov(c);
    setChains(ch);
    setEngagement(engs[0] ?? null); // most-recent engagement drives the autonomy dial
  }

  async function changeAutonomy(key: "guided" | "balanced" | "autonomous") {
    if (!engagement || engagement.autonomy === key) return;
    const prev = engagement;
    setEngagement({ ...engagement, autonomy: key }); // optimistic
    try {
      const updated = await setEngagementAutonomy(engagement.id, key);
      setEngagement(updated);
      flash(`Autonomy → ${AUTONOMY.find((a) => a.key === key)?.label}`);
    } catch (e) {
      setEngagement(prev);
      flash(e instanceof Error ? e.message : "autonomy change failed");
    }
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true);
      const [projs, fams, engs, mkt] = await Promise.all([
        fetchProjects(), fetchTaxonomyFamilies(), fetchEngines(), fetchMarketByClass(),
      ]);
      if (dead) return;
      setProjects(projs);
      setFamilies(fams);
      setEngines(engs);
      setMarket(new Map(mkt.map((m) => [m.class_id, m])));
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
          {engagement && (
            <div title="Operating mode for the active engagement — manual asks before every live action, AI lets the orchestrator act up to its risk ceiling (scope gate unchanged either way)"
                 style={{ display: "flex", gap: 1, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", background: "var(--border)" }}>
              {AUTONOMY.map((a) => {
                const on = (engagement.autonomy ?? "balanced") === a.key;
                return (
                  <button key={a.key} onClick={() => changeAutonomy(a.key)} title={a.hint}
                    style={{
                      border: "none", padding: "5px 10px", fontSize: 10, letterSpacing: "0.06em",
                      textTransform: "uppercase", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: on ? 700 : 500,
                      background: on ? a.color : "var(--panel)",
                      color: on ? "var(--bg)" : "var(--muted)",
                    }}>
                    {a.label}
                  </button>
                );
              })}
            </div>
          )}
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
                          {market.get(c.id)?.max_bounty ? (
                            <span title={`market: ${market.get(c.id)!.count} disclosed, up to ${money(market.get(c.id)!.max_bounty)} paid`}
                              style={{ fontSize: 9, fontWeight: 700, color: "var(--accent)", fontFamily: "'JetBrains Mono', monospace" }}>
                              {money(market.get(c.id)!.max_bounty)}
                            </span>
                          ) : null}
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
          market={market.get(selected.id) ?? null}
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

function ClassDrawer({ cls, feeds, market, onClose, onMark }: {
  cls: CoverageClass; feeds: Chain[]; market: MarketClass | null;
  onClose: () => void; onMark: (c: CoverageClass, s: "none" | "partial" | "covered") => void;
}) {
  const reportable = cls.informational_only !== 1;
  const [meth, setMeth] = useState<Methodology | null>(null);
  const [methLoading, setMethLoading] = useState(true);
  const [showAi, setShowAi] = useState(false);

  useEffect(() => {
    let dead = false;
    setMethLoading(true); setMeth(null);
    fetchMethodology(cls.id).then((m) => { if (!dead) { setMeth(m); setMethLoading(false); } });
    return () => { dead = true; };
  }, [cls.id]);

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
            <span title="taxonomy payout heat (priced for dupe/triage drift)" style={{ fontSize: 12, color: PAYOUT_COLOR[cls.payout_rank], fontFamily: "'JetBrains Mono', monospace" }}>{dollars(cls.payout_rank)} payout</span>
            {market?.max_bounty ? (
              <span title={`disclosed market: ${market.count} report(s), ${market.paid_count} paid, median ${money(market.median_bounty)}`}
                style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", fontFamily: "'JetBrains Mono', monospace", border: "1px solid var(--accent)", borderRadius: 4, padding: "1px 7px" }}>
                {money(market.max_bounty)} market · {market.count} rep
              </span>
            ) : null}
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

          {/* ── Codified methodology (deterministic steps + optional AI hook) ── */}
          <div>
            <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 5 }}>
              <ListChecks size={11} /> Methodology
            </div>
            {methLoading ? (
              <div style={{ fontSize: 11, color: "var(--muted)" }}>loading playbook…</div>
            ) : meth && meth.has_methodology ? (
              <>
                {meth.boundary && (
                  <div style={{ margin: "4px 0 8px 0", padding: "7px 10px", borderRadius: 5, background: "var(--panel)", borderLeft: "2px solid var(--accent)", fontSize: 11, color: "var(--text)", lineHeight: 1.5 }}>
                    <span style={{ color: "var(--accent)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 0.4 }}>BOUNDARY</span>{" "}
                    <span style={{ color: "var(--muted)" }}>{meth.boundary}</span>
                  </div>
                )}
                <ol style={{ margin: "4px 0 0 0", paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                  {meth.steps.map((s, i) => (
                    <li key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--text)", lineHeight: 1.45 }}>
                      <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 4, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--accent)", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
                {meth.ai_hook && (
                  <div style={{ marginTop: 8 }}>
                    <button className="action-btn" style={showAi ? activeStyle("var(--info)") : {}} onClick={() => setShowAi((v) => !v)}>
                      <Sparkles size={12} /> AI enhancement {showAi ? "" : "(optional)"}
                    </button>
                    {showAi && (
                      <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 5, background: "var(--panel)", border: "1px dashed var(--info)", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
                        {meth.ai_hook}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
                No codified playbook yet for this class — work it from the signal above. (Methodologies are authored money-classes-first.)
              </div>
            )}
          </div>

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
