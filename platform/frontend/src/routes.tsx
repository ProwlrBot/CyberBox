import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import {
  Target, Search, Activity, Flag, Archive, Workflow, BarChart2,
  Code2, GitBranch, Network, GitMerge, Layers, GitFork,
  FlaskConical, Globe, Container, Zap, Package, LayoutGrid, Server,
  Plug, Wrench, Bot, Cpu, Brain,
  Monitor, Terminal, BookOpen, FolderOpen, FileCode2, ScrollText, Compass,
  Radio, Heart, ShieldAlert, KeyRound, Settings, ShieldCheck, ListTodo,
} from "lucide-react";
import { StubPage } from "./pages/_stubs/StubPage";

const Dashboard    = lazy(() => import("./pages/dashboard/Dashboard"));
const Targets      = lazy(() => import("./pages/hunt/Targets"));
const Findings     = lazy(() => import("./pages/hunt/Findings"));
const CveIntel     = lazy(() => import("./pages/hunt/CveIntel"));
const Jobs         = lazy(() => import("./pages/hunt/Jobs"));
const Traffic      = lazy(() => import("./pages/hunt/Traffic"));
const Evidence     = lazy(() => import("./pages/hunt/Evidence"));
const Workflows    = lazy(() => import("./pages/hunt/Workflows"));
const Reports      = lazy(() => import("./pages/hunt/Reports"));
const SettingsPage = lazy(() => import("./pages/settings/Settings"));
const BrowserHunt  = lazy(() => import("./pages/workspace/BrowserHunt"));
const HQ           = lazy(() => import("./pages/workspace/HQ"));
const ReconPage    = lazy(() => import("./pages/hunt/Recon"));
const Raptor       = lazy(() => import("./pages/source/Raptor"));
const Repositories = lazy(() => import("./pages/source/Repositories"));
const SourceGraph  = lazy(() => import("./pages/source/SourceGraph"));
const PatchIntel      = lazy(() => import("./pages/source/PatchIntel"));
const GitLabProfile   = lazy(() => import("./pages/source/GitLabProfile"));
const VercelProfile   = lazy(() => import("./pages/source/VercelProfile"));
const WordPressProfile = lazy(() => import("./pages/source/WordPressProfile"));
const VariantHunt  = lazy(() => import("./pages/source/VariantHunt"));
const LabManager   = lazy(() => import("./pages/labs/LabManager"));
const WordPress    = lazy(() => import("./pages/labs/WordPress"));
const GitLabLab    = lazy(() => import("./pages/labs/GitLab"));
const VercelLab    = lazy(() => import("./pages/labs/VercelLab"));
const ContainersLab = lazy(() => import("./pages/labs/Containers"));
const ToolCenter   = lazy(() => import("./pages/tools/ToolCenter"));
const Providers    = lazy(() => import("./pages/tools/Providers"));
const Plugins      = lazy(() => import("./pages/tools/Plugins"));
const MCPCenter    = lazy(() => import("./pages/tools/MCP"));
const ModelsPage   = lazy(() => import("./pages/tools/Models"));
const Scripts      = lazy(() => import("./pages/workspace/Scripts"));
const CodePage     = lazy(() => import("./pages/workspace/Code"));
const TerminalPage = lazy(() => import("./pages/workspace/Terminal"));
const JupyterPage  = lazy(() => import("./pages/workspace/Jupyter"));
const FilesPage    = lazy(() => import("./pages/workspace/Files"));
const ActivityPage = lazy(() => import("./pages/system/Activity"));
const HealthPage   = lazy(() => import("./pages/system/Health"));
const ScopeGuard   = lazy(() => import("./pages/system/ScopeGuard"));
const Secrets      = lazy(() => import("./pages/system/Secrets"));

export interface NavItem { label: string; path: string; Icon: React.FC<{ size?: number }> }
export interface NavSection { id: string; label: string; items: NavItem[] }

export const NAV_SECTIONS: NavSection[] = [
  { id: "hunt", label: "HUNT", items: [
    { label: "Targets",   path: "/hunt/targets",   Icon: Target },
    { label: "Recon",     path: "/hunt/recon",     Icon: Search },
    { label: "Traffic",   path: "/hunt/traffic",   Icon: Activity },
    { label: "Findings",  path: "/hunt/findings",  Icon: Flag },
    { label: "CVE Intel", path: "/hunt/cve-intel", Icon: ShieldAlert },
    { label: "Evidence",  path: "/hunt/evidence",  Icon: Archive },
    { label: "Workflows", path: "/hunt/workflows", Icon: Workflow },
    { label: "Reports",   path: "/hunt/reports",   Icon: BarChart2 },
  ]},
  { id: "source", label: "SOURCE", items: [
    { label: "Raptor",       path: "/source/raptor",    Icon: Code2 },
    { label: "Repositories", path: "/source/repos",     Icon: GitBranch },
    { label: "Source Graph", path: "/source/graph",     Icon: Network },
    { label: "Patch Intel",  path: "/source/patch",     Icon: GitMerge },
    { label: "Variant Hunt", path: "/source/variants",  Icon: Layers },
    { label: "GitLab",       path: "/source/gitlab",    Icon: GitFork },
    { label: "Vercel Hunt",  path: "/source/vercel",    Icon: Globe },
    { label: "WordPress",    path: "/source/wordpress", Icon: Package },
  ]},
  { id: "labs", label: "LABS", items: [
    { label: "Lab Manager", path: "/labs/manager",    Icon: FlaskConical },
    { label: "WordPress",   path: "/labs/wordpress",  Icon: LayoutGrid },
    { label: "GitLab",      path: "/labs/gitlab",     Icon: Server },
    { label: "Vercel",      path: "/labs/vercel",     Icon: Zap },
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
    { label: "HQ",           path: "/workspace/hq",       Icon: Monitor },
    { label: "Code",         path: "/workspace/code",     Icon: FileCode2 },
    { label: "Browser Hunt", path: "/workspace/browser",  Icon: Compass },
    { label: "Scripts",      path: "/workspace/scripts",  Icon: ScrollText },
    { label: "Terminal",     path: "/workspace/terminal", Icon: Terminal },
    { label: "Jupyter",      path: "/workspace/jupyter",  Icon: BookOpen },
    { label: "Files",        path: "/workspace/files",    Icon: FolderOpen },
  ]},
  { id: "system", label: "SYSTEM", items: [
    { label: "Jobs",       path: "/system/jobs",     Icon: ListTodo },
    { label: "Activity",   path: "/system/activity", Icon: Radio },
    { label: "Health",     path: "/system/health",   Icon: Heart },
    { label: "ScopeGuard", path: "/system/scope",    Icon: ShieldCheck },
    { label: "Secrets",    path: "/system/secrets",  Icon: KeyRound },
    { label: "Settings",   path: "/settings",        Icon: Settings },
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
  // Hunt
  { path: "hunt/targets",   element: <Suspense fallback={null}><Targets /></Suspense> },
  { path: "hunt/recon",     element: <Suspense fallback={null}><ReconPage /></Suspense> },
  { path: "hunt/traffic",   element: <Suspense fallback={null}><Traffic /></Suspense> },
  { path: "hunt/findings",  element: <Suspense fallback={null}><Findings /></Suspense> },
  { path: "hunt/cve-intel", element: <Suspense fallback={null}><CveIntel /></Suspense> },
  { path: "hunt/evidence",  element: <Suspense fallback={null}><Evidence /></Suspense> },
  { path: "hunt/workflows", element: <Suspense fallback={null}><Workflows /></Suspense> },
  { path: "hunt/reports",   element: <Suspense fallback={null}><Reports /></Suspense> },
  // Source
  { path: "source/raptor",    element: <Suspense fallback={null}><Raptor /></Suspense> },
  { path: "source/repos",     element: <Suspense fallback={null}><Repositories /></Suspense> },
  { path: "source/graph",     element: <Suspense fallback={null}><SourceGraph /></Suspense> },
  { path: "source/patch",     element: <Suspense fallback={null}><PatchIntel /></Suspense> },
  { path: "source/variants",  element: <Suspense fallback={null}><VariantHunt /></Suspense> },
  { path: "source/gitlab",    element: <Suspense fallback={null}><GitLabProfile /></Suspense> },
  { path: "source/vercel",    element: <Suspense fallback={null}><VercelProfile /></Suspense> },
  { path: "source/wordpress", element: <Suspense fallback={null}><WordPressProfile /></Suspense> },
  { path: "source/*",         element: S("Source") },
  // Labs
  { path: "labs/manager",     element: <Suspense fallback={null}><LabManager /></Suspense> },
  { path: "labs/wordpress",   element: <Suspense fallback={null}><WordPress /></Suspense> },
  { path: "labs/gitlab",      element: <Suspense fallback={null}><GitLabLab /></Suspense> },
  { path: "labs/vercel",      element: <Suspense fallback={null}><VercelLab /></Suspense> },
  { path: "labs/containers",  element: <Suspense fallback={null}><ContainersLab /></Suspense> },
  { path: "labs/*",           element: S("Labs") },
  // Tools
  { path: "tools/tools",      element: <Suspense fallback={null}><ToolCenter /></Suspense> },
  { path: "tools/providers",  element: <Suspense fallback={null}><Providers /></Suspense> },
  { path: "tools/plugins",    element: <Suspense fallback={null}><Plugins /></Suspense> },
  { path: "tools/mcp",        element: <Suspense fallback={null}><MCPCenter /></Suspense> },
  { path: "tools/models",     element: <Suspense fallback={null}><ModelsPage /></Suspense> },
  { path: "tools/*",          element: S("Tools") },
  // Workspace
  { path: "workspace/hq",      element: <Suspense fallback={null}><HQ /></Suspense> },
  { path: "workspace/browser", element: <Suspense fallback={null}><BrowserHunt /></Suspense> },
  { path: "workspace/scripts", element: <Suspense fallback={null}><Scripts /></Suspense> },
  { path: "workspace/code",     element: <Suspense fallback={null}><CodePage /></Suspense> },
  { path: "workspace/terminal", element: <Suspense fallback={null}><TerminalPage /></Suspense> },
  { path: "workspace/jupyter",  element: <Suspense fallback={null}><JupyterPage /></Suspense> },
  { path: "workspace/files",    element: <Suspense fallback={null}><FilesPage /></Suspense> },
  { path: "workspace/*",       element: S("Workspace") },
  // System
  { path: "system/jobs",      element: <Suspense fallback={null}><Jobs /></Suspense> },
  { path: "system/activity",  element: <Suspense fallback={null}><ActivityPage /></Suspense> },
  { path: "system/health",    element: <Suspense fallback={null}><HealthPage /></Suspense> },
  { path: "system/scope",     element: <Suspense fallback={null}><ScopeGuard /></Suspense> },
  { path: "system/secrets",   element: <Suspense fallback={null}><Secrets /></Suspense> },
  { path: "system/*",         element: S("System") },
  // Settings
  { path: "settings/*",       element: <Suspense fallback={null}><SettingsPage /></Suspense> },
];
