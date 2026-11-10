import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { getApiKey } from "../../lib/api";

type Profile = {
  id: string;
  name: string;
  description: string;
  maturity: string;
};

type RuntimeData = {
  project?: { id: string; name: string } | null;
  engagement?: { id: string; name: string } | null;
  profile?: { id: string; name: string; maturity: string } | null;
};

const MATURITY_COLOR: Record<string, string> = {
  stable: "var(--good)",
  preview: "var(--warn)",
  experimental: "var(--bad)",
};

function maturityColor(m: string): string {
  return MATURITY_COLOR[m] ?? "var(--muted)";
}

export default function Providers() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [runtime, setRuntime] = useState<RuntimeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};

    async function fetchData() {
      try {
        const [profRes, projRes] = await Promise.all([
          fetch("/api/v1/profiles", { headers }),
          fetch("/api/v1/projects", { headers }),
        ]);

        const profs: Profile[] = profRes.ok ? await profRes.json() : [];
        const projs = projRes.ok ? await projRes.json() : [];
        const pid: string = projs[0]?.id ?? "";

        let rt: RuntimeData | null = null;
        if (pid) {
          const rtRes = await fetch(`/api/v1/runtime?project_id=${encodeURIComponent(pid)}`, { headers });
          if (rtRes.ok) rt = await rtRes.json();
        }

        if (!cancelled) {
          setProfiles(profs);
          setRuntime(rt);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page-targets">
      <div className="page-toolbar">
        <div className="page-title">
          <Cpu size={16} />
          <span>Providers</span>
          <small>{profiles.length} profiles</small>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Loading profiles…</div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {/* Runtime Status */}
          {runtime && (
            <div style={{ marginBottom: 28 }}>
              <div
                style={{
                  fontSize: 12, fontWeight: 600, color: "var(--muted)",
                  marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
                }}
              >
                Runtime Status
              </div>
              <div
                style={{
                  display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 12,
                }}
              >
                {[
                  { label: "Project", value: runtime.project?.name ?? "—" },
                  { label: "Engagement", value: runtime.engagement?.name ?? "—" },
                  { label: "Profile", value: runtime.profile?.name ?? "—" },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    style={{
                      background: "var(--panel)", border: "1px solid var(--border)",
                      borderRadius: 6, padding: "14px 16px",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                      {stat.label}
                    </div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Profiles card grid */}
          <div
            style={{
              fontSize: 12, fontWeight: 600, color: "var(--muted)",
              marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
            }}
          >
            Profiles
          </div>
          {profiles.length === 0 ? (
            <div className="empty-state-block" style={{ paddingLeft: 0 }}>
              <p>No profiles loaded.</p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 14,
              }}
            >
              {profiles.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: "var(--panel)", border: "1px solid var(--border)",
                    borderRadius: 6, padding: "16px 18px",
                    display: "flex", flexDirection: "column", gap: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{p.name}</span>
                    <code
                      className="type-badge"
                      style={{ color: maturityColor(p.maturity), borderColor: maturityColor(p.maturity) }}
                    >
                      {p.maturity}
                    </code>
                  </div>
                  <p
                    style={{
                      fontSize: 12, color: "var(--muted)", lineHeight: 1.55, margin: 0,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {p.description || "No description available."}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
