import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_SECTIONS } from "../routes";
import { useProfile } from "../contexts/ProfileContext";

const COLLAPSED_KEY = "cyberbox.sidebar.collapsed.v1";
const SECTIONS_KEY  = "cyberbox.sidebar.open-sections.v1";

function readSet(key: string, def: string[]): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? "null") as string[]); }
  catch { return new Set(def); }
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const [openSections, setOpenSections] = useState<Set<string>>(() => readSet(SECTIONS_KEY, ["hunt"]));
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { activeProfile } = useProfile();

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  }

  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(SECTIONS_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  return (
    <aside className={`cb-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="cb-sidebar-brand">
        {!collapsed && <span className="cb-brand-name">CYBER<b>BOX</b></span>}
        <button className="cb-sidebar-toggle" onClick={toggleCollapse} aria-label="Toggle sidebar">
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="cb-sidebar-nav">
        {NAV_SECTIONS.map((section) => {
          const isOpen = openSections.has(section.id);
          const sectionActive = section.items.some(
            (item) => pathname === item.path || pathname.startsWith(item.path + "/")
          );
          return (
            <div key={section.id} className="cb-nav-section">
              {!collapsed && (
                <button
                  className={`cb-nav-section-header${sectionActive ? " section-active" : ""}`}
                  onClick={() => toggleSection(section.id)}
                >
                  <span>{section.label}</span>
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              )}
              {(isOpen || collapsed) && section.items.map((item) => {
                const active = pathname === item.path || pathname.startsWith(item.path + "/");
                return (
                  <button
                    key={item.path}
                    className={`cb-nav-item${active ? " active" : ""}`}
                    onClick={() => navigate(item.path)}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.Icon size={16} />
                    {!collapsed && <span>{item.label}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="cb-sidebar-foot">
        <div className="cb-profile-badge" title={activeProfile?.name ?? "No profile"}>
          <span className="cb-profile-avatar">
            {(activeProfile?.name ?? "?")[0].toUpperCase()}
          </span>
          {!collapsed && (
            <div className="cb-profile-meta">
              <strong>{activeProfile?.name ?? "No profile"}</strong>
              <span className={`cb-maturity-pill ${activeProfile?.maturity ?? "preview"}`}>
                {activeProfile?.maturity ?? "preview"}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
