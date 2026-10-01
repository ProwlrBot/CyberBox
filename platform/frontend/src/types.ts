export type Confidence = "low" | "medium" | "high";

export interface ProfileManifest {
  description: string;
  recommended_panels: string[];
  domains: string[];
  agents: string[];
  playbooks: string[];
  default_autonomy: "guided" | "balanced" | "autonomous";
  default_layout: string;
  runtime: { network_mode: string; rootless: boolean; cpu_limit: number; memory_mb: number; pids_limit: number };
  controls: Record<string, boolean>;
  evidence: { artifact_hashing: boolean; timeline_required: boolean };
}

export interface ProfileDetail {
  id: string;
  name: string;
  version: string;
  maturity: "stable" | "preview";
  manifest: ProfileManifest;
  builtin: boolean;
  created_at: string;
}

export interface Hypothesis {
  id: string;
  title: string;
  claim: string;
  status: string;
  confidence: Confidence;
  updated_at: string;
  target?: string;
}

export interface EvidenceItem {
  id: string;
  time: string;
  type: "HTTP" | "KNOWLEDGE" | "VERIFIER" | "SKEPTIC";
  title: string;
  detail: string;
  verdict: string;
  tone: "active" | "positive" | "warning";
}

export interface ProfileSummary {
  id: string;
  name: string;
  maturity: "stable" | "preview";
}

export interface EngagementSummary {
  id: string;
  name: string;
  profile_id: string;
}

export interface WorkspaceData {
  hypotheses: Hypothesis[];
  projectName: string;
  engagementName: string;
  profileName: string;
  profileMaturity: "stable" | "preview";
  activeEngagementId: string;
  engagements: EngagementSummary[];
  profiles: ProfileSummary[];
  connected: boolean;
  demoMode: boolean;
  runtime: RuntimeSummary;
}

export interface RuntimeSurfaceItem {
  id: string;
  name: string;
  location: string;
  state: string;
  note: string;
}

export interface RuntimeSummary {
  project: { id: string; name: string } | null;
  engagement: { id: string; name: string; profile_id: string; status?: string } | null;
  profile: { id: string; name: string; maturity: "stable" | "preview"; manifest?: { recommended_panels?: string[] } } | null;
  surface: RuntimeSurfaceItem[];
  separation: { state: string; note: string };
}
