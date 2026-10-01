interface Props { name: string; onNameChange: (v: string) => void; onNext: () => void }

export function Step1Welcome({ name, onNameChange, onNext }: Props) {
  return (
    <div className="wizard-step">
      <div className="wizard-eyebrow">Welcome to CyberBox</div>
      <h1 className="wizard-title">Set up your workspace</h1>
      <p className="wizard-body">
        CyberBox is a security research OS. Give your workspace a name — this becomes
        your default project name. You can change it anytime from Settings.
      </p>
      <label className="wizard-field">
        <span>Workspace name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Acme Bug Bounty"
        />
      </label>
      <div className="wizard-actions">
        <button className="wizard-primary" disabled={!name.trim()} onClick={onNext}>
          Choose a profile →
        </button>
      </div>
    </div>
  );
}
