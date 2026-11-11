import { useEffect, useState, useCallback } from "react";
import { BookOpen, ChevronDown, ChevronRight, CheckSquare, Square, AlertTriangle,
         Play, Copy, Zap, Filter, Tag, Terminal } from "lucide-react";
import {
  fetchTechniques, fetchTechnique, fetchProjects, createTechniqueRun,
  fetchTechniqueRun, updateTestResult,
  type Technique, type TechniqueStage, type TechniqueTest,
} from "../../lib/api";

const CATEGORY_LABELS: Record<string, string> = {
  api: "API", auth: "Auth", "access-control": "Access Control",
  injection: "Injection", web: "Web", mobile: "Mobile", cloud: "Cloud",
};

const DIFF_COLOR: Record<string, string> = {
  easy: "var(--good)", medium: "var(--warn)", hard: "var(--bad)",
};

const TOOL_COLOR: Record<string, string> = {
  gori: "var(--accent)", manual: "var(--muted)", nuclei: "#c084fc",
  subfinder: "var(--info)", ffuf: "var(--warn)",
};

type TestStatus = "pending" | "done" | "skipped" | "finding";

type RunState = {
  runId: string;
  results: Record<string, { status: TestStatus; notes: string; result: string }>;
};

function PayloadBlock({ payload }: { payload: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(payload).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div style={{ position: "relative", marginTop: 8 }}>
      <pre style={{
        margin: 0, padding: "8px 36px 8px 10px",
        background: "var(--panel)", border: "1px solid var(--border)",
        borderRadius: 4, fontSize: 11, fontFamily: "JetBrains Mono, monospace",
        color: "var(--accent)", overflowX: "auto", whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}>{payload}</pre>
      <button
        onClick={copy}
        style={{
          position: "absolute", top: 6, right: 6,
          background: "none", border: "none", cursor: "pointer",
          color: copied ? "var(--good)" : "var(--muted)", padding: 2,
        }}
        title="Copy payload"
      >
        {copied ? "✓" : <Copy size={12} />}
      </button>
    </div>
  );
}

function TestCard({
  test, status, onStatus, runId,
}: {
  test: TechniqueTest;
  status: TestStatus;
  onStatus: (testId: string, s: TestStatus) => void;
  runId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const statusColors: Record<TestStatus, string> = {
    pending: "var(--muted)",
    done: "var(--good)",
    skipped: "var(--border)",
    finding: "var(--bad)",
  };

  async function markAs(s: TestStatus) {
    if (!runId) return;
    setSaving(true);
    try {
      await updateTestResult(runId, test.id, s, notes, "");
      onStatus(test.id, s);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      border: `1px solid ${status !== "pending" ? statusColors[status] : "var(--border)"}`,
      borderRadius: 6, marginBottom: 6, overflow: "hidden",
      background: "var(--panel-2)",
    }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 10px", cursor: "pointer",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ color: statusColors[status], flexShrink: 0 }}>
          {status === "done" ? <CheckSquare size={14} /> :
           status === "finding" ? <AlertTriangle size={14} /> :
           status === "skipped" ? <Square size={14} style={{ opacity: 0.3 }} /> :
           <Square size={14} />}
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{test.name}</span>
        {test.tool && (
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 3,
            background: "var(--panel)", border: "1px solid var(--border)",
            color: TOOL_COLOR[test.tool] ?? "var(--muted)",
            fontFamily: "JetBrains Mono, monospace",
          }}>
            {test.tool === "gori" ? <Terminal size={9} style={{ verticalAlign: "middle", marginRight: 2 }} /> : null}
            {test.tool}
          </span>
        )}
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </div>

      {expanded && (
        <div style={{ padding: "0 10px 10px", borderTop: "1px solid var(--border)" }}>
          {test.expected && (
            <p style={{ fontSize: 12, color: "var(--info)", margin: "8px 0 4px" }}>
              <strong style={{ color: "var(--muted)" }}>Expected: </strong>{test.expected}
            </p>
          )}
          {test.payload && <PayloadBlock payload={test.payload} />}

          {runId && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => markAs("done")}
                disabled={saving}
                style={{
                  padding: "3px 10px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                  border: "1px solid var(--good)", background: status === "done" ? "var(--good)" : "transparent",
                  color: status === "done" ? "#000" : "var(--good)",
                }}
              >
                <CheckSquare size={10} style={{ marginRight: 4 }} />Done
              </button>
              <button
                onClick={() => markAs("finding")}
                disabled={saving}
                style={{
                  padding: "3px 10px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                  border: "1px solid var(--bad)", background: status === "finding" ? "var(--bad)" : "transparent",
                  color: status === "finding" ? "#000" : "var(--bad)",
                }}
              >
                <AlertTriangle size={10} style={{ marginRight: 4 }} />Finding
              </button>
              <button
                onClick={() => markAs("skipped")}
                disabled={saving}
                style={{
                  padding: "3px 10px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                  border: "1px solid var(--border)", background: "transparent",
                  color: "var(--muted)",
                }}
              >
                Skip
              </button>
              <input
                placeholder="Notes…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{
                  flex: 1, minWidth: 120, height: 26, fontSize: 11,
                  background: "var(--panel)", border: "1px solid var(--border)",
                  borderRadius: 4, padding: "0 8px", color: "var(--text)",
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StagePanel({
  stage, runState, onStatus, runId,
}: {
  stage: TechniqueStage;
  runState: Record<string, { status: TestStatus }>;
  onStatus: (testId: string, s: TestStatus) => void;
  runId: string | null;
}) {
  const [open, setOpen] = useState(true);
  const doneCount = stage.tests.filter((t) => runState[t.id]?.status === "done" || runState[t.id]?.status === "finding").length;
  const findingCount = stage.tests.filter((t) => runState[t.id]?.status === "finding").length;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px", background: "var(--panel-2)",
          border: "1px solid var(--border)", borderRadius: open ? "6px 6px 0 0" : 6,
          cursor: "pointer",
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ fontWeight: 600, fontSize: 13 }}>{stage.name}</span>
        {stage.goal && (
          <span style={{ fontSize: 11, color: "var(--muted)", flex: 1 }}>— {stage.goal}</span>
        )}
        <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--muted)" }}>
          {doneCount}/{stage.tests.length}
          {findingCount > 0 && (
            <span style={{ color: "var(--bad)", marginLeft: 6 }}>
              {findingCount} finding{findingCount > 1 ? "s" : ""}
            </span>
          )}
        </span>
      </div>
      {open && (
        <div style={{
          padding: 10, border: "1px solid var(--border)", borderTop: "none",
          borderRadius: "0 0 6px 6px", background: "var(--bg)",
        }}>
          {stage.description && (
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
              {stage.description}
            </p>
          )}
          {stage.tests.map((test) => (
            <TestCard
              key={test.id}
              test={test}
              status={runState[test.id]?.status ?? "pending"}
              onStatus={onStatus}
              runId={runId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Techniques() {
  const [techniques, setTechniques] = useState<Technique[]>([]);
  const [selected, setSelected] = useState<Technique | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [runState, setRunState] = useState<RunState | null>(null);
  const [projectId, setProjectId] = useState("");
  const [targetHost, setTargetHost] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    Promise.all([fetchTechniques(), fetchProjects()]).then(([techs, projects]) => {
      setTechniques(techs);
      if (projects.length) setProjectId(projects[0].id);
      if (techs.length) loadDetail(techs[0]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadDetail = useCallback(async (tech: Technique) => {
    setDetailLoading(true);
    const full = await fetchTechnique(tech.id);
    if (full) setSelected(full);
    setDetailLoading(false);
    setRunState(null);
  }, []);

  async function startRun() {
    if (!selected || !projectId) return;
    setStarting(true);
    try {
      const run = await createTechniqueRun(selected.id, projectId, targetHost);
      setRunState({ runId: run.id, results: {} });
    } finally {
      setStarting(false);
    }
  }

  function handleStatus(testId: string, status: TestStatus) {
    setRunState((prev) => prev ? {
      ...prev,
      results: { ...prev.results, [testId]: { status, notes: "", result: "" } },
    } : null);
  }

  const categories = ["all", ...Array.from(new Set(techniques.map((t) => t.category)))];
  const filtered = categoryFilter === "all" ? techniques : techniques.filter((t) => t.category === categoryFilter);

  const totalTests = selected?.stages?.reduce((a, s) => a + s.tests.length, 0) ?? 0;
  const doneTests = runState
    ? Object.values(runState.results).filter((r) => r.status === "done" || r.status === "finding").length
    : 0;
  const findingsCount = runState
    ? Object.values(runState.results).filter((r) => r.status === "finding").length
    : 0;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── Left sidebar: technique list ── */}
      <div style={{
        width: 240, flexShrink: 0, borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          padding: "10px 12px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <BookOpen size={14} style={{ color: "var(--accent)" }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Techniques</span>
          <span style={{
            marginLeft: "auto", fontSize: 11, fontFamily: "JetBrains Mono, monospace",
            color: "var(--muted)",
          }}>{techniques.length}</span>
        </div>

        {/* Category filter */}
        <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                style={{
                  padding: "2px 8px", fontSize: 10, borderRadius: 10, cursor: "pointer",
                  border: "1px solid var(--border)",
                  background: categoryFilter === cat ? "var(--accent)" : "var(--panel-2)",
                  color: categoryFilter === cat ? "#000" : "var(--muted)",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 16, color: "var(--muted)", fontSize: 12 }}>Loading…</div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filtered.map((tech) => (
              <div
                key={tech.id}
                onClick={() => loadDetail(tech)}
                style={{
                  padding: "8px 12px", cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                  background: selected?.id === tech.id ? "var(--panel-2)" : "transparent",
                  borderLeft: selected?.id === tech.id ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{tech.name}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{
                    fontSize: 10, color: "var(--muted)",
                    fontFamily: "JetBrains Mono, monospace",
                  }}>
                    {CATEGORY_LABELS[tech.category] ?? tech.category}
                  </span>
                  <span style={{
                    fontSize: 10, color: DIFF_COLOR[tech.difficulty] ?? "var(--muted)",
                    fontFamily: "JetBrains Mono, monospace",
                  }}>
                    {tech.difficulty}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Main detail area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selected ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--muted)", flexDirection: "column", gap: 8,
          }}>
            <BookOpen size={32} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: 13 }}>Select a technique to begin</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{
              padding: "12px 16px", borderBottom: "1px solid var(--border)",
              background: "var(--panel-2)",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{selected.name}</h2>
                    <span style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 3,
                      background: "var(--panel)", border: "1px solid var(--border)",
                      color: DIFF_COLOR[selected.difficulty] ?? "var(--muted)",
                      fontFamily: "JetBrains Mono, monospace",
                    }}>{selected.difficulty}</span>
                    <span style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 3,
                      background: "var(--panel)", border: "1px solid var(--border)",
                      color: "var(--accent)", fontFamily: "JetBrains Mono, monospace",
                    }}>{CATEGORY_LABELS[selected.category] ?? selected.category}</span>
                  </div>
                  {selected.description && (
                    <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                      {selected.description}
                    </p>
                  )}
                  {selected.cwe_classes?.length > 0 && (
                    <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                      {selected.cwe_classes.map((cwe) => (
                        <span key={cwe} style={{
                          fontSize: 10, padding: "1px 6px", borderRadius: 10,
                          background: "var(--panel)", border: "1px solid var(--border)",
                          color: "var(--warn)", fontFamily: "JetBrains Mono, monospace",
                        }}>
                          <Tag size={8} style={{ marginRight: 3 }} />{cwe}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Run controls */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
                  {!runState ? (
                    <>
                      <input
                        placeholder="Target host (e.g. api.target.com)"
                        value={targetHost}
                        onChange={(e) => setTargetHost(e.target.value)}
                        style={{
                          width: 220, height: 28, fontSize: 11,
                          background: "var(--panel)", border: "1px solid var(--border)",
                          borderRadius: 4, padding: "0 8px", color: "var(--text)",
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      />
                      <button
                        onClick={startRun}
                        disabled={starting || !projectId}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "5px 14px", fontSize: 12, cursor: "pointer",
                          background: "var(--accent)", border: "none", borderRadius: 4,
                          color: "#000", fontWeight: 600,
                        }}
                      >
                        <Play size={12} />
                        {starting ? "Starting…" : "Start Session"}
                      </button>
                    </>
                  ) : (
                    <div style={{ textAlign: "right" }}>
                      <div style={{
                        fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                        color: "var(--good)", marginBottom: 4,
                      }}>
                        <Zap size={11} style={{ marginRight: 4, verticalAlign: "middle" }} />
                        Session active
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {doneTests}/{totalTests} done
                        {findingsCount > 0 && (
                          <span style={{ color: "var(--bad)", marginLeft: 8 }}>
                            {findingsCount} finding{findingsCount > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      {totalTests > 0 && (
                        <div style={{
                          marginTop: 4, height: 3, width: 120,
                          background: "var(--border)", borderRadius: 2,
                        }}>
                          <div style={{
                            height: "100%", borderRadius: 2,
                            width: `${Math.round((doneTests / totalTests) * 100)}%`,
                            background: findingsCount > 0 ? "var(--bad)" : "var(--good)",
                            transition: "width 0.3s",
                          }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Stage list */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {detailLoading ? (
                <div style={{ color: "var(--muted)", fontSize: 12 }}>Loading technique…</div>
              ) : !selected.stages?.length ? (
                <div style={{ color: "var(--muted)", fontSize: 12 }}>No stages defined.</div>
              ) : (
                selected.stages.map((stage) => (
                  <StagePanel
                    key={stage.id}
                    stage={stage}
                    runState={runState?.results ?? {}}
                    onStatus={handleStatus}
                    runId={runState?.runId ?? null}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
