import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ProfileDetail } from "../types";

const ACTIVE_KEY       = "cyberbox.active-profile.v1";
const FIRST_LAUNCH_KEY = "cyberbox.first-launch.v1";

async function fetchProfilesFromApi(): Promise<ProfileDetail[]> {
  const key = localStorage.getItem("cyberbox.api-key.v1") ?? "";
  try {
    const r = await fetch("/api/v1/profiles", {
      headers: key ? { "X-Api-Key": key } : {},
    });
    if (!r.ok) return [];
    const rows = await r.json() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      manifest: typeof row.manifest === "string"
        ? JSON.parse(row.manifest as string)
        : row.manifest,
    })) as ProfileDetail[];
  } catch {
    return [];
  }
}

interface ProfileCtx {
  profiles: ProfileDetail[];
  activeProfile: ProfileDetail | null;
  activeProfileId: string;
  setActiveProfile: (id: string) => void;
  firstLaunch: boolean;
  completeFirstLaunch: () => void;
  reloadProfiles: () => Promise<void>;
}

const Ctx = createContext<ProfileCtx>({
  profiles: [], activeProfile: null, activeProfileId: "",
  setActiveProfile: () => undefined, firstLaunch: false, completeFirstLaunch: () => undefined,
  reloadProfiles: async () => undefined,
});

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<ProfileDetail[]>([]);
  const [activeProfileId, setActiveProfileIdState] = useState(
    () => localStorage.getItem(ACTIVE_KEY) ?? "bug-bounty"
  );
  const [firstLaunch, setFirstLaunchState] = useState(
    () => localStorage.getItem(FIRST_LAUNCH_KEY) !== "done"
  );

  useEffect(() => {
    fetchProfilesFromApi().then(setProfiles).catch(() => undefined);
  }, []); // empty dep — fetch once on mount

  function setActiveProfile(id: string) {
    setActiveProfileIdState(id);
    localStorage.setItem(ACTIVE_KEY, id);
  }

  function completeFirstLaunch() {
    setFirstLaunchState(false);
    localStorage.setItem(FIRST_LAUNCH_KEY, "done");
  }

  async function reloadProfiles() {
    const data = await fetchProfilesFromApi();
    setProfiles(data);
  }

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;

  return (
    <Ctx.Provider value={{ profiles, activeProfile, activeProfileId, setActiveProfile, firstLaunch, completeFirstLaunch, reloadProfiles }}>
      {children}
    </Ctx.Provider>
  );
}

export function useProfile(): ProfileCtx { return useContext(Ctx); }
