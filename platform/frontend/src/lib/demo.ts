import type { EvidenceItem, WorkspaceData } from "../types";

export const demoWorkspace: WorkspaceData = {
  projectName: "Acme Security",
  engagementName: "Acme Bug Bounty",
  profileName: "Bug Bounty",
  profileMaturity: "stable",
  activeEngagementId: "demo-bounty",
  engagements: [{ id: "demo-bounty", name: "Acme Bug Bounty", profile_id: "bug-bounty" }],
  profiles: [{ id: "bug-bounty", name: "Bug Bounty", maturity: "stable" }],
  connected: false,
  demoMode: true,
  runtime: {
    project: { id: "demo-project", name: "Acme Security" },
    engagement: {
      id: "demo-bounty",
      name: "Acme Bug Bounty",
      profile_id: "bug-bounty",
      status: "authorized",
    },
    profile: {
      id: "bug-bounty",
      name: "Bug Bounty",
      maturity: "stable",
      manifest: { recommended_panels: ["browser", "traffic", "terminal", "findings"] },
    },
    surface: [
      {
        id: "control-plane",
        name: "Control plane",
        location: "platform/backend",
        state: "Ready",
        note: "API, project, policy, and evidence coordination live here.",
      },
      {
        id: "workspace-shell",
        name: "Workspace shell",
        location: "separate sandbox runtime",
        state: "Separated",
        note: "Browser, terminal, Jupyter, code-server, and the Plugin Center run in the workstation container.",
      },
      {
        id: "plugin-center",
        name: "Plugin Center",
        location: "/csbx/",
        state: "Ready",
        note: "Plugin catalog and service recovery live in the sandbox dashboard.",
      },
    ],
    separation: {
      state: "Separated",
      note: "The live workspace shell is intentionally isolated from this control plane.",
    },
  },
  hypotheses: [
    { id: "H-001", title: "IDOR in account export endpoint", claim: "Authenticated users may export another account by changing userId.", confidence: "high", status: "Investigating", updated_at: "2m ago", target: "GET /api/export/{userId}" },
    { id: "H-002", title: "Stored XSS in project name field", claim: "Project names may render without contextual encoding.", confidence: "medium", status: "Needs evidence", updated_at: "15m ago", target: "POST /api/projects" },
    { id: "H-003", title: "Broken access control in file download", claim: "Files can be downloaded without object ownership checks.", confidence: "high", status: "Investigating", updated_at: "1m ago", target: "GET /api/files/{id}/download" },
  ],
};

export const evidence: EvidenceItem[] = [
  { id: "e1", time: "11:24:31", type: "HTTP", title: "GET /api/files/84219/download", detail: "200 OK · 15.2 KB · 812ms", verdict: "Relevant", tone: "positive" },
  { id: "e2", time: "11:24:33", type: "KNOWLEDGE", title: "OWASP API1: Broken Object Level Authorization", detail: "Object ownership must be checked for every identifier-based request.", verdict: "Supports", tone: "positive" },
  { id: "e3", time: "11:24:36", type: "VERIFIER", title: "Access Control Verifier", detail: "Compared five object IDs across two authenticated sessions; 3/5 exposed.", verdict: "Passed", tone: "positive" },
  { id: "e4", time: "11:24:40", type: "SKEPTIC", title: "Skeptic review", detail: "Alternative explanation: the file may be intentionally public. Confirm visibility policy.", verdict: "Consider", tone: "warning" },
];
