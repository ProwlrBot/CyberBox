import { useCallback, useEffect, useState } from "react";
import { Cpu, Wifi, WifiOff, Loader2, HardDrive, Cloud } from "lucide-react";
import { getApiKey } from "../lib/api";

type Provider = {
  id: string; name: string; kind: string; base_url: string;
  api_key_env: string | null; default_model: string | null; local: number;
};
type Probe = { status: "ok" | "error" | "loading"; error?: string; models?: string[] };

function headers(): Record<string, string> {
  const key = getApiKey();
  return key ? { "X-Api-Key": key } : {};
}

export default function ProviderPicker() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/providers", { headers: headers() });
      if (r.ok) setProviders(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function probe(id: string) {
    setProbes((p) => ({ ...p, [id]: { status: "loading" } }));
    try {
      const r = await fetch(`/api/v1/providers/${id}/probe`, { headers: headers() });
      const d = await r.json();
      setProbes((p) => ({
        ...p,
        [id]: { status: d.status === "ok" ? "ok" : "error", error: d.error, models: d.models },
      }));
    } catch (e) {
      setProbes((p) => ({ ...p, [id]: { status: "error", error: (e as Error).message } }));
    }
  }

  if (loading) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="cbx-eyebrow" style={{ marginBottom: 10 }}>Model providers · connect local or cloud</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {providers.map((p) => {
          const pr = probes[p.id];
          const isLocal = p.local === 1;
          return (
            <div key={p.id} className="cbx-metric" style={{ cursor: "default" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="cbx-choice-badge" style={{ width: 28, height: 28, marginBottom: 0, borderRadius: 7 }}>
                  <Cpu size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </div>
                  <div className="cbx-mono" style={{ fontSize: 10, color: "var(--muted)" }}>{p.id}</div>
                </div>
                <span className="cbx-sev low" style={{ borderLeftColor: isLocal ? "var(--good)" : "var(--info)", color: isLocal ? "var(--good)" : "var(--info)" }}>
                  {isLocal ? <HardDrive size={10} /> : <Cloud size={10} />} {isLocal ? "local" : "cloud"}
                </span>
              </div>
              <div className="cbx-mono" style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.base_url}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                {p.default_model ? <>model <span className="cbx-mono" style={{ color: "var(--text)" }}>{p.default_model}</span></> : "any loaded model"}
                {p.api_key_env && <> · key <span className="cbx-mono">${p.api_key_env}</span></>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <button className="cbx-btn cbx-btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => probe(p.id)}>
                  Test connection
                </button>
                {pr?.status === "loading" && <Loader2 size={14} className="spin" style={{ color: "var(--muted)" }} />}
                {pr?.status === "ok" && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--good)", fontSize: 11.5 }}>
                    <Wifi size={13} /> reachable{pr.models?.length ? ` · ${pr.models.length} models` : ""}
                  </span>
                )}
                {pr?.status === "error" && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--bad)", fontSize: 11.5 }} title={pr.error}>
                    <WifiOff size={13} /> down
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12, display: "flex", gap: 7, alignItems: "flex-start" }}>
        <span style={{ color: "var(--accent)" }}>→</span>
        <span>
          <b>LM Studio</b> and your local <b>pi</b> connect through the <span className="cbx-mono">lmstudio</span> provider
          (<span className="cbx-mono">localhost:1234/v1</span>, no external gate). Start LM Studio's local server, then Test.
          Keys are read from the named env var — never stored.
        </span>
      </div>
    </div>
  );
}
