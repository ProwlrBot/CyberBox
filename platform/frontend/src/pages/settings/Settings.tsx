import { useState } from "react";
import { ProfileSection }    from "./sections/ProfileSection";
import { ConnectionSection } from "./sections/ConnectionSection";
import { EngagementSection } from "./sections/EngagementSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { ToolsSection }      from "./sections/ToolsSection";
import { AboutSection }      from "./sections/AboutSection";

type Tab = "connection" | "profile" | "engagement" | "appearance" | "tools" | "about";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "connection", label: "Connection" },
  { id: "profile",    label: "Profile" },
  { id: "engagement", label: "Engagement" },
  { id: "appearance", label: "Appearance" },
  { id: "tools",      label: "Tools" },
  { id: "about",      label: "About" },
];

export default function Settings() {
  const [active, setActive] = useState<Tab>(() =>
    localStorage.getItem("cyberbox.api-key.v1") ? "profile" : "connection"
  );
  return (
    <div className="settings-layout">
      <nav className="settings-subnav" aria-label="Settings sections">
        <div className="settings-subnav-label">Settings</div>
        {TABS.map((tab) => (
          <button key={tab.id}
            className={`settings-subnav-item${active === tab.id ? " active" : ""}`}
            onClick={() => setActive(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="settings-content">
        {active === "connection" && <ConnectionSection />}
        {active === "profile"    && <ProfileSection />}
        {active === "engagement" && <EngagementSection />}
        {active === "appearance" && <AppearanceSection />}
        {active === "tools"      && <ToolsSection />}
        {active === "about"      && <AboutSection />}
      </main>
    </div>
  );
}
