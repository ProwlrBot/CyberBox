import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Fingerprint, Zap, RefreshCw, Download, ChevronRight, ChevronDown, ExternalLink,
  Copy, Crosshair, ShieldAlert, Sparkles, Target, FlaskConical,
} from "lucide-react";
import {
  fetchProjects, fetchTechniqueLibrary, fetchProjectTechniques, fetchTechniquePlan,
  extractTechniques, syncDisclosures, getApiKey,
  type TechniqueLead, type TechniquePlan,
} from "../../lib/api";

function money(n: number | null | undefined): string {
  if (!n) return "—";
  return n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n}`;
}

function noveltyColor(n: number): string {
  if (n >= 75) return "var(--accent)";
  if (n >= 55) return "var(--warn)";
  return "var(--muted)";
}

/** One technique lead — the reusable invariant a cluster of disclosed reports teaches. */
function LeadCard({ lead, overlay }: { lead: TechniqueLead; overlay: boolean }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<TechniquePlan | null>(null);
  const [copied, setCopied] = useState(false);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next && !plan) fetchTechniquePlan(lead.class_id).then(setPlan);
  }, [open, plan, lead.class_id]);

  const copyPlan = useCallback(() => {
    if (!plan) return;
    const lines = [
      `# Technique: ${plan.class_name}`,
      plan.invariant ? `# Boundary (the invariant that fails): ${plan.invariant}` : "",
      `# STATUS: ${plan.status.toUpperCase()} — ${plan.disclaimer}`,
      "",
      ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
      "",
      plan.ai_hook ? `AI (optional): ${plan.ai_hook}` : "",
      "",
      "Reports that teach this:",
      ...plan.example_reports.map((e) => `  - ${e.title} ${e.url}`),
    ].filter(Boolean);
    void navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [plan]);

  return (
    <div className="cbx-panel" style={{ padding: 0, overflow: "hidden", borderColor: lead.is_boundary ? "rgba(228,242,34,0.22)" : "var(--border)" }}>
      <button onClick={toggle} style={{
        all: "unset", cursor: "pointer", display: "grid",
        gridTemplateColumns: "20px 1fr auto", gap: 12, alignItems: "center",
        padding: "14px 16px", width: "100%", boxSizing: "border-box",
      }}>
        <span style={{ color: "var(--muted)" }}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{lead.class_name}</span>
            {lead.is_boundary && (
              <span className="cbx-mono" style={{
                fontSize: 9, letterSpacing: "0.1em", color: "#0a0b0c", background: "var(--accent)",
                padding: "1px 6px", borderRadius: 3, fontWeight: 600,
              }}>BOUNDARY</span>
            )}
            <span className="cbx-mono" title="confidence of the report→technique match" style={{
              fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", padding: "1px 6px",
              borderRadius: 3, border: "1px solid var(--border)",
              color: lead.confidence === "high" ? "var(--good)" : lead.confidence === "medium" ? "var(--warn)" : "var(--muted)",
            }}>{lead.confidence} match</span>
            <span className="cbx-mono" style={{ fontSize: 10, color: "var(--muted)" }}>F{lead.family_num}</span>
          </div>
          {lead.invariant && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.45 }}>
              <span style={{ color: noveltyColor(lead.avg_novelty) }}>▸ </span>{lead.invariant}
            </div>
          )}
          {overlay && lead.reason && (
            <div style={{ fontSize: 11, color: "var(--info)", marginTop: 5, display: "flex", alignItems: "center", gap: 5 }}>
              <Target size={11} /> {lead.reason}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <Stat label="novelty" value={String(lead.avg_novelty)} color={noveltyColor(lead.avg_novelty)} />
          <Stat label="reports" value={String(lead.report_count)} />
          <Stat label="top pay" value={money(lead.max_bounty)} color={lead.max_bounty ? "var(--good)" : "var(--muted)"} />
        </div>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px 16px", background: "var(--bg)" }}>
          {!plan ? (
            <div className="cbx-mono" style={{ fontSize: 11, color: "var(--muted)" }}>loading test plan…</div>
          ) : (
            <>
              <div style={{
                display: "flex", gap: 7, alignItems: "flex-start", fontSize: 11, color: "var(--warn)",
                background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)",
                borderRadius: 5, padding: "7px 10px", marginBottom: 12, lineHeight: 1.5,
              }}>
                <ShieldAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span><b>Observed, not verified.</b> {plan.disclaimer}</span>
              </div>

              {plan.has_methodology ? (
                <>
                  <div className="cbx-panel-title" style={{ marginBottom: 8 }}>Copy-ready test plan</div>
                  <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                    {plan.steps.map((s, i) => (
                      <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--text)", lineHeight: 1.45 }}>
                        <span className="cbx-mono" style={{
                          flexShrink: 0, width: 18, height: 18, borderRadius: 4, background: "var(--panel)",
                          border: "1px solid var(--border)", color: "var(--accent)", fontSize: 10,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>{i + 1}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                  {plan.ai_hook && (
                    <div style={{
                      marginTop: 10, padding: "8px 10px", borderRadius: 5, background: "var(--panel)",
                      border: "1px dashed var(--info)", fontSize: 11, color: "var(--muted)", lineHeight: 1.5,
                      display: "flex", gap: 7,
                    }}>
                      <Sparkles size={13} style={{ flexShrink: 0, color: "var(--info)" }} />
                      <span><b style={{ color: "var(--info)" }}>AI (optional): </b>{plan.ai_hook}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="cbx-mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                  No codified playbook yet for this class — work it from the example reports below.
                </div>
              )}

              {/* reportability gate */}
              {plan.reportability && (
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className={`cbx-gate ${plan.reportability.standalone_reportable ? "pass" : "fail"}`}>
                    {plan.reportability.standalone_reportable ? "Reportable standalone" : "Chain-only (not standalone)"}
                  </span>
                  {plan.reportability.feeds_chains?.slice(0, 3).map((c) => (
                    <span key={c.id} className="cbx-mono" style={{ fontSize: 10, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 7px" }}>
                      → {c.name} ({c.result_priority})
                    </span>
                  ))}
                </div>
              )}

              {/* example reports */}
              <div className="cbx-panel-title" style={{ margin: "16px 0 8px" }}>Reports that teach this</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {plan.example_reports.map((e) => (
                  <a key={e.id} href={e.url} target="_blank" rel="noreferrer" style={{
                    display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text)",
                    textDecoration: "none", padding: "6px 8px", borderRadius: 5, border: "1px solid var(--border)",
                    background: "var(--panel)",
                  }}>
                    <ExternalLink size={12} style={{ flexShrink: 0, color: "var(--muted)" }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>
                    {e.program_name && <span className="cbx-mono" style={{ fontSize: 10, color: "var(--muted)" }}>{e.program_name}</span>}
                    {e.bounty_amount ? <span className="cbx-mono" style={{ fontSize: 10, color: "var(--good)" }}>{money(e.bounty_amount)}</span> : null}
                  </a>
                ))}
              </div>

              {plan.has_methodology && (
                <button className="cbx-btn cbx-btn-ghost" style={{ marginTop: 14, fontSize: 12, padding: "7px 13px" }} onClick={copyPlan}>
                  <Copy size={13} /> {copied ? "Copied" : "Copy test plan"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div className="cbx-mono" style={{ fontSize: 15, fontWeight: 500, color: color ?? "var(--text)", lineHeight: 1 }}>{value}</div>
      <div className="cbx-mono" style={{ fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

export default function Disclosures() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<"library" | "overlay">("library");
  const [boundaryOnly, setBoundaryOnly] = useState(false);
  const [leads, setLeads] = useState<TechniqueLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const data = mode === "overlay" && projectId
      ? await fetchProjectTechniques(projectId)
      : await fetchTechniqueLibrary({ boundaryOnly });
    setLeads(data);
    setLoading(false);
  }, [mode, projectId, boundaryOnly]);

  useEffect(() => { fetchProjects().then((p) => { setProjects(p); if (p[0]) setProjectId(p[0].id); }); }, []);
  useEffect(() => { if (getApiKey()) void load(); else setLoading(false); }, [load]);

  const sync = useCallback(async () => {
    setBusy("sync");
    const r = await syncDisclosures();
    setBusy("");
    if (r) { flash(`Synced disclosures: +${r.inserted} new of ${r.parsed}`); void load(); }
    else flash("Sync failed — check the hacktivity-bot feed / API key");
  }, [flash, load]);

  const reextract = useCallback(async () => {
    setBusy("extract");
    const r = await extractTechniques(true);
    setBusy("");
    if (r) { flash(`Re-extracted ${r.processed} reports → ${r.techniques_written} techniques`); void load(); }
    else flash("Extract failed");
  }, [flash, load]);

  const metrics = useMemo(() => {
    const boundary = leads.filter((l) => l.is_boundary).length;
    const maxPay = leads.reduce((m, l) => Math.max(m, l.max_bounty ?? 0), 0);
    const reports = leads.reduce((s, l) => s + l.report_count, 0);
    return { techniques: leads.length, boundary, maxPay, reports };
  }, [leads]);

  return (
    <div className="cbx-page" style={{ maxWidth: 1180 }}>
      <div className="cbx-hero">
        <div className="cbx-eyebrow"><Fingerprint size={11} style={{ verticalAlign: "-1px", marginRight: 6 }} />Technique Intelligence</div>
        <div className="cbx-h1">Disclosed reports → the invariant they teach</div>
        <p className="cbx-sub">
          Every disclosed report is classified by the <b>boundary</b> that failed — two components disagreeing about a request,
          identity, object or response — not the payload. A library of reusable leads mapped to your methodology spine.
          Each technique is <b>observed in the wild, not verified on your target</b>: a hypothesis to prove, never a finding to file.
        </p>
        <div className="cbx-metrics" style={{ marginTop: 18 }}>
          <Metric label="Techniques" value={String(metrics.techniques)} accent />
          <Metric label="Boundary-differential" value={String(metrics.boundary)} />
          <Metric label="Top bounty taught" value={money(metrics.maxPay)} />
          <Metric label="Reports mined" value={String(metrics.reports)} />
        </div>
      </div>

      <div className="page-toolbar" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 1, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", background: "var(--border)" }}>
          {([["library", "Library", Zap], ["overlay", "Hunt this next", Crosshair]] as const).map(([k, label, Icon]) => {
            const on = mode === k;
            return (
              <button key={k} onClick={() => setMode(k)} style={{
                border: "none", padding: "6px 13px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                fontFamily: "var(--cbx-mono)", fontWeight: on ? 700 : 500,
                background: on ? "var(--accent)" : "var(--panel)", color: on ? "#0a0b0c" : "var(--muted)",
              }}><Icon size={12} /> {label}</button>
            );
          })}
        </div>
        {mode === "overlay" && projects.length > 0 && (
          <select className="action-btn" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {mode === "library" && (
          <button className="action-btn" style={boundaryOnly ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}}
            onClick={() => setBoundaryOnly((v) => !v)}>Boundary only</button>
        )}
        <div style={{ flex: 1 }} />
        <button className="action-btn" disabled={busy !== ""} onClick={sync}>
          <Download size={13} /> {busy === "sync" ? "Syncing…" : "Sync feed"}
        </button>
        <button className="action-btn" disabled={busy !== ""} onClick={reextract}>
          <RefreshCw size={13} /> {busy === "extract" ? "Extracting…" : "Re-extract"}
        </button>
      </div>

      {loading ? (
        <div className="cbx-mono" style={{ color: "var(--muted)", padding: 24 }}>loading technique library…</div>
      ) : !getApiKey() ? (
        <div className="cbx-empty"><FlaskConical size={40} /><p>Set an API key to load technique intelligence.</p></div>
      ) : leads.length === 0 ? (
        <div className="cbx-empty">
          <Fingerprint size={40} />
          <p style={{ marginTop: 12 }}>
            {mode === "overlay"
              ? "No uncovered techniques for this target yet — sync the feed, or every taught class is already covered."
              : "No techniques yet. Sync the disclosures feed to mine reusable invariants from the wild."}
          </p>
          <button className="cbx-btn cbx-btn-primary" style={{ marginTop: 14 }} onClick={sync} disabled={busy !== ""}>
            <Download size={14} /> Sync disclosures feed
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {leads.map((l) => <LeadCard key={l.class_id} lead={l} overlay={mode === "overlay"} />)}
        </div>
      )}

      {toast && (
        <div className="cbx-mono" style={{
          position: "fixed", bottom: 22, right: 22, background: "var(--panel)", border: "1px solid var(--accent)",
          color: "var(--text)", padding: "10px 16px", borderRadius: 7, fontSize: 12, zIndex: 50,
          boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
        }}>{toast}</div>
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="cbx-metric">
      <div className="cbx-metric-label">{label}</div>
      <div className={`cbx-metric-value${accent ? " is-accent" : ""}`}>{value}</div>
    </div>
  );
}
