import { useProfile } from "../../../contexts/ProfileContext";

export function ProfileSection() {
  const { profiles, activeProfile, setActiveProfile } = useProfile();
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Research profile</h2>
      <p className="settings-section-desc">
        Profiles configure workspace mode, policy defaults, and recommended panels.
        Built-in profiles cannot be edited. Switch at any time.
      </p>
      <div className="profile-list">
        {profiles.map((p) => (
          <div key={p.id} className={`profile-list-row${activeProfile?.id === p.id ? " active" : ""}`}>
            <div className="profile-list-main">
              <div className="profile-list-name">
                <strong>{p.name}</strong>
                <span className={`cb-maturity-pill ${p.maturity}`}>{p.maturity}</span>
              </div>
              <p className="profile-list-desc">{p.manifest?.description ?? ""}</p>
              <div className="profile-list-domains">
                {(p.manifest?.domains ?? []).map((d) => (
                  <span key={d} className="profile-card-tag">{d}</span>
                ))}
              </div>
            </div>
            <div className="profile-list-actions">
              {activeProfile?.id === p.id
                ? <span className="profile-active-badge">Active</span>
                : <button className="profile-activate-btn" onClick={() => setActiveProfile(p.id)}>Activate</button>
              }
            </div>
          </div>
        ))}
        {profiles.length === 0 && (
          <p className="empty-state">Connect the API to load profiles.</p>
        )}
      </div>
    </div>
  );
}
