import { Suspense, useEffect, useState } from "react";
import { useRoutes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { CommandPalette } from "./components/CommandPalette";
import { ProfileWizard } from "./components/wizard/ProfileWizard";
import { useProfile } from "./contexts/ProfileContext";
import { appRoutes } from "./routes";

export function App() {
  const { firstLaunch } = useProfile();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const routeElement = useRoutes(appRoutes);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <Header onCommandPalette={() => setPaletteOpen(true)} />
      <main className="app-main">
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          {routeElement}
        </Suspense>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {firstLaunch && <ProfileWizard />}
    </div>
  );
}
