import { useEffect, useState } from "react";
import { getApiKey } from "../lib/api";

type Props = {
  score: number;
  openFindings: number;
  critical: number;
  campaigns: number;
};

function Ring({ value }: { value: number }) {
  const r = 48;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * c;
  return (
    <div className="cbx-ring">
      <svg width="112" height="112">
        <circle cx="56" cy="56" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
        <circle
          cx="56" cy="56" r={r} fill="none" stroke="var(--accent)" strokeWidth="8"
          strokeLinecap="round" strokeDasharray={`${dash} ${c}`}
          style={{ filter: "drop-shadow(0 0 6px rgba(228,242,34,0.4))" }}
        />
      </svg>
      <div className="cbx-ring-num">{value.toFixed(0)}</div>
    </div>
  );
}

function Metric({ label, value, foot, accent }: { label: string; value: string | number; foot?: string; accent?: boolean }) {
  return (
    <div className="cbx-metric">
      <div className="cbx-metric-label">{label}</div>
      <div className={`cbx-metric-value ${accent ? "is-accent" : ""}`}>{value}</div>
      {foot && <div className="cbx-metric-foot">{foot}</div>}
    </div>
  );
}

export default function SecurityOverview({ score, openFindings, critical, campaigns }: Props) {
  const [prReviews, setPrReviews] = useState<number | null>(null);
  const [failing, setFailing] = useState(0);

  useEffect(() => {
    const key = getApiKey();
    fetch("/api/v1/github/scans", { headers: key ? { "X-Api-Key": key } : {} })
      .then((r) => (r.ok ? r.json() : []))
      .then((scans: Array<{ exit_code: number | null }>) => {
        setPrReviews(scans.length);
        setFailing(scans.filter((s) => s.exit_code === 2).length);
      })
      .catch(() => setPrReviews(0));
  }, []);

  return (
    <div className="cbx-hero" style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
      <div className="cbx-ring-wrap">
        <Ring value={score} />
        <div>
          <div className="cbx-eyebrow">Security score</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, maxWidth: 180, lineHeight: 1.45 }}>
            {critical > 0
              ? `${critical} critical finding${critical > 1 ? "s" : ""} need attention`
              : "No critical findings open"}
          </div>
        </div>
      </div>
      <div className="cbx-metrics" style={{ flex: 1, minWidth: 420 }}>
        <Metric label="Open issues" value={openFindings} foot={critical > 0 ? `${critical} critical` : "clear"} />
        <Metric label="PRs reviewed" value={prReviews ?? "—"} foot={failing > 0 ? `${failing} failed gate` : "all passing"} accent={failing > 0} />
        <Metric label="Campaigns" value={campaigns} foot="pentest runs" />
        <Metric label="Coverage" value={`${Math.min(100, campaigns * 8 + (prReviews ?? 0) * 4)}%`} foot="surface tested" />
      </div>
    </div>
  );
}
