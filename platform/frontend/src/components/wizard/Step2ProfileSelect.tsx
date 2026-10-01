import { useProfile } from "../../contexts/ProfileContext";

interface Props { onSelect: (id: string) => void }

const PROFILE_ACCENT: Record<string, string> = {
  "bug-bounty":                    "#e4f222",
  "web-application-testing":       "#60a5fa",
  "api-security":                  "#a78bfa",
  "mobile-security":               "#4ade80",
  "cloud-security":                "#38bdf8",
  "container-kubernetes-security": "#fb923c",
  "malware-analysis":              "#f87171",
  "digital-forensics":             "#94a3b8",
  "osint":                         "#fbbf24",
  "soc-incident-response":         "#34d399",
  "ctf":                           "#e879f9",
  "security-education":            "#a3e635",
  "red-team":                      "#f87171",
  "blue-team":                     "#60a5fa",
  "purple-team":                   "#a78bfa",
  "custom":                        "#8a93a0",
};

export function Step2ProfileSelect({ onSelect }: Props) {
  const { profiles } = useProfile();

  if (profiles.length === 0) {
    return (
      <div className="wizard-step">
        <div className="wizard-eyebrow">Step 2 of 3</div>
        <h1 className="wizard-title">Connect the API first</h1>
        <p className="wizard-body">
          Profiles are loaded from the CyberBox control plane. Set your API key
          in the header, then refresh this page to continue.
        </p>
        <div className="wizard-actions">
          <button className="wizard-secondary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard-step">
      <div className="wizard-eyebrow">Step 2 of 3</div>
      <h1 className="wizard-title">Choose a research profile</h1>
      <p className="wizard-body">
        Profiles set workspace mode, policy defaults, and recommended panels.
        You can switch at any time from Settings → Profile.
      </p>
      <div className="profile-card-grid">
        {profiles.map((p) => (
          <button
            key={p.id}
            className="profile-card"
            onClick={() => onSelect(p.id)}
            style={{ "--card-accent": PROFILE_ACCENT[p.id] ?? "#e4f222" } as React.CSSProperties}
          >
            <div className="profile-card-top">
              <strong className="profile-card-name">{p.name}</strong>
              <span className={`cb-maturity-pill ${p.maturity}`}>{p.maturity}</span>
            </div>
            <p className="profile-card-desc">{p.manifest?.description ?? ""}</p>
            <div className="profile-card-domains">
              {(p.manifest?.domains ?? []).slice(0, 3).map((d) => (
                <span key={d} className="profile-card-tag">{d}</span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
