import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import {
  Target, Search, Activity, Flag, Archive, Workflow, BarChart2,
  Code2, GitBranch, Network,
  FlaskConical, Globe, Container,
  Plug, Wrench, Bot, Cpu, Brain,
  Monitor, Terminal, BookOpen, FolderOpen,
  Radio, Heart, ShieldAlert, KeyRound, Settings,
} from "lucide-react";
import { StubPage } from "./pages/_stubs/StubPage";

const Dashboard   = lazy(() => import("./pages/dashboard/Dashboard"));
const Targets     = lazy(() => import("./pages/hunt/Targets"));
const Findings    = lazy(() => import("./pages/hunt/Findings"));
const Jobs        = lazy(() => import("./pages/hunt/Jobs"));
const SettingsPage = lazy(() => import("./pages/settings/Settings"));
const BrowserHunt  = lazy(() => import("./pages/workspace/BrowserHunt"));

export interface NavItem { label: string; path: string; Icon: React.FC<{ size?: number }> }
export interface NavSection { id: string; label: string; items: NavItem[] }

export const NAV_SECTIONS: NavSection[] = [
  { id: "hunt", label: "HUNT", items: [
    { label: "Targets",   path: "/hunt/targets",   Icon: Target },
    { label: "Recon",     path: "/hunt/recon",     Icon: Search },
    { label: "Traffic",   path: "/hunt/traffic",   Icon: Activity },
    { label: "Findings",  path: "/hunt/findings",  Icon: Flag },
    { label: "Evidence",  path: "/hunt/evidence",  Icon: Archive },
    { label: "Workflows", path: "/hunt/workflows", Icon: Workflow },
    { label: "Reports",   path: "/hunt/reports",   Icon: BarChart2 },
  ]},
  { id: "source", label: "SOURCE", items: [
    { label: "Raptor",       path: "/source/raptor",   Icon: Code2 },
    { label: "Repositories", path: "/source/repos",    Icon: GitBranch },
    { label: "Source Graph", path: "/source/graph",    Icon: Network },
    { label: "Patch Intel",  path: "/source/patch",    Icon: Activity },
    { label: "Variant Hunt", path: "/source/variants", Icon: Search },
  ]},
  { id: "labs", label: "LABS", items: [
    { label: "Lab Manager", path: "/labs/manager",    Icon: FlaskConical },
    { label: "WordPress",   path: "/labs/wordpress",  Icon: Globe },
    { label: "GitLab",      path: "/labs/gitlab",     Icon: GitBranch },
    { label: "Vercel",      path: "/labs/vercel",     Icon: Globe },
    { label: "Containers",  path: "/labs/containers", Icon: Container },
  ]},
  { id: "tools", label: "TOOLS", items: [
    { label: "Plugin Center", path: "/tools/plugins",   Icon: Plug },
    { label: "Tool Center",   path: "/tools/tools",     Icon: Wrench },
    { label: "MCP Center",    path: "/tools/mcp",       Icon: Bot },
    { label: "Providers",     path: "/tools/providers", Icon: Cpu },
    { label: "AI Models",     path: "/tools/models",    Icon: Brain },
  ]},
  { id: "workspace", label: "WORKSPACE", items: [
    { label: "Code",     path: "/workspace/code",     Icon: Code2 },
    { label: "Browser Hunt", path: "/workspace/browser", Icon: Monitor },
    { label: "Terminal", path: "/workspace/terminal", Icon: Terminal },
    { label: "Jupyter",  path: "/workspace/jupyter",  Icon: BookOpen },
    { label: "Files",    path: "/workspace/files",    Icon: FolderOpen },
  ]},
  { id: "system", label: "SYSTEM", items: [
    { label: "Jobs",       path: "/system/jobs",    Icon: Cpu },
    { label: "Activity",   path: "/system/activity",Icon: Radio },
    { label: "Health",     path: "/system/health",  Icon: Heart },
    { label: "ScopeGuard", path: "/system/scope",   Icon: ShieldAlert },
    { label: "Secrets",    path: "/system/secrets", Icon: KeyRound },
    { label: "Settings",   path: "/settings",       Icon: Settings },
  ]},
];

function S(label: string) {
  return (
    <Suspense fallback={null}>
      <StubPage label={label} />
    </Suspense>
  );
}

export const appRoutes: RouteObject[] = [
  { index: true, element: <Suspense fallback={null}><Dashboard /></Suspense> },
  { path: "hunt/targets",   element: <Suspense fallback={null}><Targets /></Suspense> },
  { path: "hunt/findings",  element: <Suspense fallback={null}><Findings /></Suspense> },
  { path: "hunt/recon",     element: S("Recon") },
  { path: "hunt/traffic",   element: S("Traffic Workbench") },
  { path: "hunt/evidence",  element: S("Evidence Center") },
  { path: "hunt/workflows", element: S("Workflows") },
  { path: "hunt/reports",   element: S("Reports") },
  { path: "source/*",       element: S("Source") },
  { path: "labs/*",         element: S("Labs") },
  { path: "tools/*",        element: S("Tools") },
  { path: "workspace/browser", element: <Suspense fallback={null}><BrowserHunt /></Suspense> },
  { path: "workspace/*",    element: S("Workspace") },
  { path: "system/jobs",    element: <Suspense fallback={null}><Jobs /></Suspense> },
  { path: "system/*",       element: S("System") },
  { path: "settings/*",     element: <Suspense fallback={null}><SettingsPage /></Suspense> },
];
