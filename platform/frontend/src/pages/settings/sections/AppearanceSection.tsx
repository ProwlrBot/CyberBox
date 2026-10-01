export function AppearanceSection() {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Appearance</h2>
      <p className="settings-section-desc">Color tokens and font settings. Prowlr design system is active.</p>
      <div className="token-preview">
        {(
          [
            ["--accent", "Accent"],
            ["--good",   "Good"],
            ["--warn",   "Warn"],
            ["--bad",    "Bad"],
            ["--info",   "Info"],
          ] as [string, string][]
        ).map(([v, l]) => (
          <div key={v} className="token-row">
            <span className="token-swatch" style={{ background: `var(${v})` }} />
            <code className="token-name">{v}</code>
            <span className="token-label">{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
