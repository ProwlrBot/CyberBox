import { useState } from "react";
import { useProfile } from "../../contexts/ProfileContext";
import { Step1Welcome } from "./Step1Welcome";
import { Step2ProfileSelect } from "./Step2ProfileSelect";
import { Step3TargetSetup } from "./Step3TargetSetup";

export function ProfileWizard() {
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState("");
  const { completeFirstLaunch, setActiveProfile } = useProfile();

  return (
    <div className="wizard-backdrop" role="dialog" aria-modal="true" aria-label="CyberBox setup wizard">
      <div className="wizard-shell">
        <div className="wizard-dots" aria-label="Step progress">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`wizard-dot${step === i ? " active" : step > i ? " done" : ""}`} />
          ))}
        </div>
        <div className="wizard-track-outer">
          <div className="wizard-track" style={{ transform: `translateX(-${step * 100}%)` }}>
            <div className="wizard-slide">
              <Step1Welcome name={workspaceName} onNameChange={setWorkspaceName} onNext={() => setStep(1)} />
            </div>
            <div className="wizard-slide">
              <Step2ProfileSelect onSelect={(id) => { setActiveProfile(id); setStep(2); }} />
            </div>
            <div className="wizard-slide">
              <Step3TargetSetup workspaceName={workspaceName} onFinish={completeFirstLaunch} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
