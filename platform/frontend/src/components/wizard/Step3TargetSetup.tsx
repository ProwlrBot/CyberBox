import { useState } from "react";
import { useProfile } from "../../contexts/ProfileContext";

interface Props { workspaceName: string; onFinish: () => void }

export function Step3TargetSetup({ onFinish }: Props) {
  const [target, setTarget] = useState("");
  const { activeProfile } = useProfile();

  return (
    <div className="wizard-step">
      <div className="wizard-eyebrow">Step 3 of 3</div>
      <h1 className="wizard-title">Add your first target</h1>
      <p className="wizard-body">
        Enter the primary domain or IP you're authorized to test.
        Skip for now — add targets from Hunt → Targets at any time.
      </p>
      {activeProfile && (
        <div className="wizard-profile-confirm">
          <span>Active profile:</span>
          <strong>{activeProfile.name}</strong>
          <span className={`cb-maturity-pill ${activeProfile.maturity}`}>{activeProfile.maturity}</span>
        </div>
      )}
      <label className="wizard-field">
        <span>Target domain or IP (optional)</span>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="e.g. app.example.com or 10.0.0.1/24"
        />
      </label>
      <div className="wizard-actions">
        <button className="wizard-secondary" onClick={onFinish}>Skip for now</button>
        <button className="wizard-primary" onClick={onFinish}>Launch workspace →</button>
      </div>
    </div>
  );
}
