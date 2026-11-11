import type {
  EngagementSummary, Hypothesis, ProfileSummary, RuntimeSummary, WorkspaceData,
} from "../types";

const keyName = "cyberbox.api-key.v1";
const engagementKey = "cyberbox.engagement.v1";

export function getApiKey(): string {
  return localStorage.getItem(keyName) ?? "";
}

export function setApiKey(value: string): void {
  if (value.trim()) localStorage.setItem(keyName, value.trim());
  else localStorage.removeItem(keyName);
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { "X-Api-Key": getApiKey() } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export async function loadWorkspace(): Promise<WorkspaceData | null> {
  if (!getApiKey()) return null;
  const [projects, profiles] = await Promise.all([
    request<Array<{ id: string; name: string }>>("/api/v1/projects"),
    request<ProfileSummary[]>("/api/v1/profiles"),
  ]);
  const runtime = await request<RuntimeSummary>(`/api/v1/runtime?project_id=${encodeURIComponent(projects[0]?.id ?? "")}`);
  if (!projects.length) {
    return {
      projectName: "No project loaded",
      engagementName: "No active engagement",
      profileName: runtime.profile?.name ?? "No profile",
      profileMaturity: runtime.profile?.maturity ?? "preview",
      activeEngagementId: "",
      engagements: [],
      profiles,
      hypotheses: [],
      connected: true,
      demoMode: false,
      runtime,
    };
  }
  const project = projects[0];
  const engagements = await request<EngagementSummary[]>(`/api/v1/projects/${project.id}/engagements`);
  const preferredId = localStorage.getItem(engagementKey);
  const engagement = engagements.find((item) => item.id === preferredId) ?? engagements[0];
  const hypotheses = engagement
    ? await request<Hypothesis[]>(`/api/v1/projects/${project.id}/hypotheses?engagement_id=${encodeURIComponent(engagement.id)}`)
    : [];
  const profile = profiles.find((item) => item.id === engagement?.profile_id);
  return {
    projectName: project.name,
    engagementName: engagement?.name ?? runtime.engagement?.name ?? "No active engagement",
    profileName: profile?.name ?? runtime.profile?.name ?? "No profile",
    profileMaturity: profile?.maturity ?? runtime.profile?.maturity ?? "preview",
    activeEngagementId: engagement?.id ?? "",
    engagements,
    profiles,
    hypotheses,
    connected: true,
    demoMode: false,
    runtime,
  };
}

export function selectEngagement(id: string): void {
  if (id) localStorage.setItem(engagementKey, id);
  else localStorage.removeItem(engagementKey);
}

function headers(): Record<string, string> {
  const k = getApiKey();
  return k ? { "X-Api-Key": k } : {};
}

export async function fetchProjects(): Promise<Array<{ id: string; name: string; slug: string }>> {
  if (!getApiKey()) return [];
  const r = await fetch("/api/v1/projects", { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchScore(projectId: string): Promise<{
  score: number; needs_attention: boolean;
  breakdown: Record<string, number>; total_active: number;
} | null> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/analytics/score`, { headers: headers() });
  return r.ok ? r.json() : null;
}

export async function fetchEvents(projectId: string, limit = 30): Promise<Array<{
  id: number; event_type: string; occurred_at: string; actor_type: string;
}>> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/events?limit=${limit}`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchTargets(projectId: string): Promise<Array<{
  id: string; name: string; target_type: string; pattern: string;
  normalized: string; status: string; source: string; updated_at: string;
}>> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/targets`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchFindings(projectId: string): Promise<Array<{
  id: string; name: string; severity: string; category: string; cve: string | null;
  host: string; status: string; verified: boolean; detected_at: string;
}>> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/vulnerabilities`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchPendingApprovals(): Promise<Array<{
  id: string; execution_id: string; action_class: string; status: string; expires_at: string;
}>> {
  const r = await fetch("/api/v1/approvals?status=pending", { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchCampaigns(projectId: string): Promise<Array<{
  id: string; name: string; target_url: string; hunt_type: string; status: string;
  phase: string | null; progress: number; findings_count: number;
  started_at: string | null; created_at: string;
}>> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/campaigns`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function createCampaign(projectId: string, body: {
  name: string; target_url: string; hunt_type: string;
  provider_id?: string; max_runtime?: number;
}): Promise<{ id: string }> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/campaigns`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchProviders(): Promise<Array<{
  id: string; name: string; enabled: boolean;
}>> {
  const r = await fetch("/api/v1/providers", { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchCampaign(id: string): Promise<{
  id: string; name: string; target_url: string; hunt_type: string; status: string;
  phase: string | null; progress: number; findings_count: number; agent_ids: string | null;
  started_at: string | null; finished_at: string | null; created_at: string; error: string | null;
  report_md: string | null;
} | null> {
  const r = await fetch(`/api/v1/campaigns/${encodeURIComponent(id)}`, { headers: headers() });
  return r.ok ? r.json() : null;
}

export async function cancelCampaign(id: string): Promise<void> {
  await fetch(`/api/v1/campaigns/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
}

export async function fetchCampaignEvents(id: string): Promise<Array<{
  id: number; phase: string | null; event_type: string; summary: string;
  detail: unknown; occurred_at: string;
}>> {
  const r = await fetch(`/api/v1/campaigns/${encodeURIComponent(id)}/events`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchCampaignReport(id: string): Promise<{ report_md: string | null }> {
  const r = await fetch(`/api/v1/campaigns/${encodeURIComponent(id)}/report`, { headers: headers() });
  return r.ok ? r.json() : { report_md: null };
}

// ── Techniques ────────────────────────────────────────────────────────────────

export type TechniqueTest = {
  id: string; name: string; description?: string; payload?: string;
  tool?: string; endpoint?: string; expected?: string; manual: number;
};

export type TechniqueStage = {
  id: string; name: string; description?: string; goal?: string;
  stage_order: number; tests: TechniqueTest[];
};

export type Technique = {
  id: string; name: string; slug: string; description?: string;
  category: string; difficulty: string; cwe_classes: string[];
  tags: string[]; stages?: TechniqueStage[];
};

export async function fetchTechniques(): Promise<Technique[]> {
  const r = await fetch("/api/v1/techniques", { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchTechnique(id: string): Promise<Technique | null> {
  const r = await fetch(`/api/v1/techniques/${encodeURIComponent(id)}`, { headers: headers() });
  return r.ok ? r.json() : null;
}

export async function createTechniqueRun(techniqueId: string, projectId: string, targetHost: string): Promise<{ id: string }> {
  const r = await fetch(`/api/v1/techniques/${encodeURIComponent(techniqueId)}/runs`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId, target_host: targetHost }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export async function fetchTechniqueRun(techniqueId: string, runId: string): Promise<{
  id: string; technique_id: string; project_id: string; target_host: string;
  status: string; results: Record<string, { status: string; notes?: string; result?: string }>;
} | null> {
  const r = await fetch(`/api/v1/techniques/${encodeURIComponent(techniqueId)}/runs/${encodeURIComponent(runId)}`, { headers: headers() });
  return r.ok ? r.json() : null;
}

export async function updateTestResult(runId: string, testId: string, status: string, notes: string, result: string): Promise<void> {
  await fetch(`/api/v1/technique-runs/${encodeURIComponent(runId)}/tests/${encodeURIComponent(testId)}`, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ status, notes, result }),
  });
}
