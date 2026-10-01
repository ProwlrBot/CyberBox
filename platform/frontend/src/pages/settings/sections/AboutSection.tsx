export function AboutSection() {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">About CyberBox</h2>
      <dl className="about-dl">
        <dt>Version</dt><dd>0.1.0</dd>
        <dt>Control plane</dt><dd>127.0.0.1:8787</dd>
        <dt>Design system</dt><dd>Prowlr v1</dd>
        <dt>License</dt><dd>Private</dd>
      </dl>
    </div>
  );
}
