import { useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck, ChevronRight, ChevronDown, CheckCircle2, CircleDot, Circle,
  RefreshCw, Link2, BookOpen, Ban,
} from "lucide-react";
import {
  fetchProjects, fetchWstgCatalog, fetchWstgCoverage,
  type WstgCatalog, type WstgCatalogTest, type WstgCoverage, type WstgTestCov,
} from "../../lib/api";

const STATUS_COLOR: Record<string, string> = {
  covered: "var(--good)", partial: "var(--warn)", none: "var(--muted)",
};

function StatusDot({ status }: { status: string }) {
  if (status === "covered") return <CheckCircle2 size={14} style={{ color: "var(--good)" }} />;
  if (status === "partial") return <CircleDot size={14} style={{ color: "var(--warn)" }} />;
  return <Circle size={14} style={{ color: "var(--muted)" }} />;
}

const labelStyle: React.CSSProperties = {
  fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--muted)", marginBottom: 4,
};

function Tile({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 14px", minWidth: 92 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, color: color || "var(--text)", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

export default function Wstg() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [catalog, setCatalog] = useState<WstgCatalog | null>(null);
  const [cov, setCov] = useState<WstgCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const [openTest, setOpenTest] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [ps, cat] = await Promise.all([fetchProjects(), fetchWstgCatalog()]);
      setProjects(ps);
      setCatalog(cat);
      if (ps.length) setProjectId((cur) => cur || ps[0].id);
      setLoading(false);
    })();
  }, []);

  async function load(pid: string) {
    if (!pid) return;
    setCov(await fetchWstgCoverage(pid));
  }
  useEffect(() => { void load(projectId); }, [projectId]);

  // Merge static catalog text into the per-target coverage rows, keyed by test id.
  const catById = useMemo(() => {
    const m = new Map<string, WstgCatalogTest>();
    catalog?.tests.forEach((t) => m.set(t.id, t));
    return m;
  }, [catalog]);

  const testsByChapter = useMemo(() => {
    const m = new Map<string, WstgTestCov[]>();
    cov?.tests.forEach((t) => { if (!m.has(t.chapter)) m.set(t.chapter, []); m.get(t.chapter)!.push(t); });
    return m;
  }, [cov]);

  if (loading) return <div style={{ padding: 24, color: "var(--muted)" }}>Loading WSTG v4.2 catalog…</div>;

  return (
    <div style={{ padding: 20, maxWidth: 1180, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <ClipboardCheck size={20} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 18, margin: 0 }}>WSTG v4.2 Coverage</h1>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          96 OWASP tests · derived from your taxonomy coverage
        </span>
        <div style={{ flex: 1 }} />
        <select className="action-btn" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="action-btn" onClick={() => load(projectId)} title="Refresh"><RefreshCw size={13} /></button>
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        A test turns green only when a taxonomy class behind it is marked covered — by an engine (nuclei, fingerprint)
        or by hand. Catalog-only tests (<Ban size={10} style={{ verticalAlign: "middle" }} />) are a methodology
        checklist with no single auto-derivable class; they never count as covered.
      </p>

      {/* Summary tiles */}
      {cov && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
          <Tile label="Covered" value={cov.covered} color="var(--good)" />
          <Tile label="Partial" value={cov.partial} color="var(--warn)" />
          <Tile label="Mapped" value={cov.mapped} />
          <Tile label="Catalog-only" value={cov.catalog_only} color="var(--muted)" />
          <Tile label="Total" value={cov.total} />
        </div>
      )}

      {/* Chapters */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {cov?.chapters.map((ch) => {
          const open = openChapter === ch.code;
          const pct = ch.mapped ? Math.round((ch.covered / ch.mapped) * 100) : 0;
          return (
            <div key={ch.code} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
              <button
                onClick={() => setOpenChapter(open ? null : ch.code)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                         background: "var(--panel)", border: "none", cursor: "pointer", color: "var(--text)" }}
              >
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "var(--accent)", width: 48, textAlign: "left" }}>{ch.code}</span>
                <span style={{ fontSize: 13, flex: 1, textAlign: "left" }}>{ch.name}</span>
                {/* meter */}
                <div style={{ width: 160, height: 7, background: "var(--bg)", borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "var(--good)" }} />
                </div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--muted)", width: 96, textAlign: "right" }}>
                  {ch.covered}/{ch.mapped} cov
                </span>
              </button>

              {open && (
                <div style={{ padding: "4px 0", background: "var(--bg)" }}>
                  {(testsByChapter.get(ch.code) || []).map((t) => {
                    const meta = catById.get(t.id);
                    const expanded = openTest === t.id;
                    return (
                      <div key={t.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <button
                          onClick={() => setOpenTest(expanded ? null : t.id)}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 16px 8px 40px",
                                   background: "transparent", border: "none", cursor: "pointer", color: "var(--text)" }}
                        >
                          <StatusDot status={t.status} />
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--muted)", width: 128, textAlign: "left" }}>{t.id.replace("WSTG-v42-", "")}</span>
                          <span style={{ fontSize: 12, flex: 1, textAlign: "left", color: t.status === "covered" ? "var(--good)" : "var(--text)" }}>{t.title}</span>
                          {t.mapped ? (
                            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--muted)" }}>
                              <Link2 size={10} /> {t.class_ids.length} class{t.class_ids.length === 1 ? "" : "es"}
                            </span>
                          ) : (
                            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--muted)" }}>
                              <Ban size={10} /> catalog-only
                            </span>
                          )}
                        </button>
                        {expanded && meta && (
                          <div style={{ padding: "4px 16px 14px 40px", fontSize: 11.5, color: "var(--muted)", lineHeight: 1.55 }}>
                            {meta.how_to_test && (
                              <div style={{ marginBottom: 6 }}>
                                <span style={{ color: "var(--info)", display: "inline-flex", alignItems: "center", gap: 4 }}><BookOpen size={11} /> How to test&nbsp;</span>
                                {meta.how_to_test}
                              </div>
                            )}
                            {meta.reject_if && (
                              <div style={{ marginBottom: 6 }}>
                                <span style={{ color: "var(--bad)" }}>Reject if&nbsp;</span>{meta.reject_if}
                              </div>
                            )}
                            {meta.maps.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                                {meta.maps.map((m) => (
                                  <span key={m.class_id} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, border: "1px solid var(--border)",
                                           background: t.status === "covered" ? "rgba(44,224,126,0.1)" : "var(--panel)", color: "var(--text)" }}>
                                    {m.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            {t.evidence_ids.length > 0 && (
                              <div style={{ marginTop: 6, color: STATUS_COLOR[t.status] }}>
                                evidence: {t.evidence_ids.length} finding{t.evidence_ids.length === 1 ? "" : "s"} attached
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
