import { useLocation } from "react-router-dom";
import { ChevronDown, Search, Target as TargetIcon } from "lucide-react";
import { NAV_SECTIONS } from "../routes";
import { useProfile } from "../contexts/ProfileContext";

interface HeaderProps { onCommandPalette: () => void }

function useBreadcrumb(): string[] {
  const { pathname } = useLocation();
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (pathname === item.path || pathname.startsWith(item.path + "/")) {
        return [section.label, item.label];
      }
    }
  }
  if (!pathname || pathname === "/") return ["Dashboard"];
  return pathname.split("/").filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1));
}

export function Header({ onCommandPalette }: HeaderProps) {
  const crumbs = useBreadcrumb();
  const { activeProfile, profiles, setActiveProfile } = useProfile();

  return (
    <header className="cb-header">
      <nav className="cb-breadcrumb" aria-label="Breadcrumb">
        {crumbs.map((crumb, i) => (
          <span key={i}>
            {i > 0 && <span className="cb-breadcrumb-sep">/</span>}
            <span className={i === crumbs.length - 1 ? "cb-breadcrumb-current" : "cb-breadcrumb-ancestor"}>
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      <div className="cb-header-gap" />

      <div className="cb-target-badge">
        <TargetIcon size={13} />
        <span>No active target</span>
      </div>

      <div className="cb-scope-badge">
        <i className="cb-dot good" />
        <span>In scope</span>
      </div>

      <label className="cb-profile-switcher">
        <span className="cb-switcher-label">Profile</span>
        <select
          value={activeProfile?.id ?? ""}
          onChange={(e) => setActiveProfile(e.target.value)}
          aria-label="Active profile"
        >
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {profiles.length === 0 && <option value="">Loading…</option>}
        </select>
        <ChevronDown size={12} />
      </label>

      <button className="cb-search-trigger" onClick={onCommandPalette} aria-label="Open command palette (Ctrl+K)">
        <Search size={14} />
        <span>Search</span>
        <kbd>Ctrl K</kbd>
      </button>
    </header>
  );
}
