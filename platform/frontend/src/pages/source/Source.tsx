import { lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Code2,
  FileDiff,
  GitBranch,
  GitFork,
  Globe,
  Layers,
  Network,
  Package,
  ShieldCheck,
} from "lucide-react";

const Raptor = lazy(() => import("./Raptor"));
const Repositories = lazy(() => import("./Repositories"));
const CodeScanning = lazy(() => import("./CodeScanning"));
const SourceGraph = lazy(() => import("./SourceGraph"));
const PatchIntel = lazy(() => import("./PatchIntel"));
const VariantHunt = lazy(() => import("./VariantHunt"));
const Sources = lazy(() => import("./Sources"));
const GitLabProfile = lazy(() => import("./GitLabProfile"));
const VercelProfile = lazy(() => import("./VercelProfile"));
const WordPressProfile = lazy(() => import("./WordPressProfile"));

const TABS = [
  { slug: "sources", label: "Overview", Icon: GitFork, Panel: Sources },
  { slug: "repos", label: "Repositories", Icon: GitBranch, Panel: Repositories },
  { slug: "code-scan", label: "Code Scan", Icon: ShieldCheck, Panel: CodeScanning },
  { slug: "graph", label: "Graph", Icon: Network, Panel: SourceGraph },
  { slug: "patch", label: "Patch Intel", Icon: FileDiff, Panel: PatchIntel },
  { slug: "variants", label: "Variants", Icon: Layers, Panel: VariantHunt },
  { slug: "raptor", label: "Raptor", Icon: Code2, Panel: Raptor },
  { slug: "gitlab", label: "GitLab", Icon: GitFork, Panel: GitLabProfile },
  { slug: "vercel", label: "Vercel", Icon: Globe, Panel: VercelProfile },
  { slug: "wordpress", label: "WordPress", Icon: Package, Panel: WordPressProfile },
] as const;

export default function Source() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const activeTab = TABS.find((item) => item.slug === tab) ?? TABS[0];
  const ActivePanel = activeTab.Panel;

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <nav
        role="tablist"
        aria-label="Source views"
        style={{
          display: "flex",
          flexShrink: 0,
          overflowX: "auto",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
        }}
      >
        {TABS.map(({ slug, label, Icon }) => {
          const isActive = slug === activeTab.slug;
          return (
            <button
              key={slug}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls="source-tab-panel"
              onClick={() => navigate(`/source/${slug}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 14px 8px",
                border: "none",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                background: "transparent",
                color: isActive ? "var(--accent)" : "var(--muted)",
                font: "inherit",
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              <Icon size={12} />
              {label}
            </button>
          );
        })}
      </nav>

      <div id="source-tab-panel" role="tabpanel" style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={null}>
          <ActivePanel />
        </Suspense>
      </div>
    </div>
  );
}
