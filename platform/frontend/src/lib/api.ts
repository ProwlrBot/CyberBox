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

export async function fetchGenomeSummary(projectId: string): Promise<{
  by_source: Array<{ source: string; n: number; auth_ct: number }>;
  hosts: string[]; drift_count: number;
} | null> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/genome`, { headers: headers() });
  return r.ok ? r.json() : null;
}

export type GenomeEndpoint = {
  id: string; source: string; method: string; host: string; path: string;
  path_template: string | null; auth_required: number; drift_flags: string;
};

// Full endpoint row for the Node Inspector dense grid (the /genome/endpoints route returns
// SELECT * — every column below is present even though GenomeEndpoint under-declares it).
export type InspectorEndpoint = {
  id: string; project_id: string; source: string; method: string; host: string;
  path: string; path_template: string | null; params: string; auth_required: number;
  auth_schemes: string; content_types: string; status_codes: string; tags: string;
  drift_flags: string; first_seen_at: string; last_seen_at: string;
};

export async function fetchInspectorEndpoints(
  projectId: string, opts?: { host?: string; source?: string },
): Promise<InspectorEndpoint[]> {
  const q = new URLSearchParams();
  if (opts?.host) q.set("host", opts.host);
  if (opts?.source) q.set("source", opts.source);
  const qs = q.toString();
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/genome/endpoints${qs ? `?${qs}` : ""}`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchGenomeEndpoints(projectId: string, opts?: { drift?: boolean; source?: string }): Promise<GenomeEndpoint[]> {
  const q = new URLSearchParams();
  if (opts?.drift) q.set("drift", "true");
  if (opts?.source) q.set("source", opts.source);
  const qs = q.toString();
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/genome/endpoints${qs ? `?${qs}` : ""}`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function ingestOpenapi(projectId: string, spec: unknown): Promise<{ imported?: number; source?: string }> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/genome/ingest/openapi`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Passive target fingerprint (live preview) ───────────────────────────────────

export type SecurityHeaders = Record<string, string | null>;

export type WpPlugin = { slug: string; version: string | null; known_advisories?: number; advisory_ids?: string[] };
export type WpUser = { id: number | null; name: string | null; slug: string | null };

export type WordpressFingerprint = {
  target: string; is_wordpress: boolean; version: string | null; generator: string | null;
  rest_enabled: boolean; namespaces: string[]; route_count: number;
  users: WpUser[]; plugins: WpPlugin[]; themes: { slug: string; version: string | null }[];
  exposed: Record<string, boolean | number>; security_headers: SecurityHeaders;
  server: string | null; errors: string[]; vulnerable_plugin_count?: number;
};

export type GlProject = { path: string | null; name: string | null; star_count: number | null; last_activity_at: string | null };

export type GitlabFingerprint = {
  target: string; is_gitlab: boolean; version: string | null; revision: string | null;
  enterprise: boolean | null; signup_enabled: boolean | null; api_reachable: boolean;
  public_projects: GlProject[]; public_project_count: number;
  exposed: Record<string, boolean>; security_headers: SecurityHeaders;
  server: string | null; errors: string[];
};

export async function fingerprintWordPress(projectId: string, targetUrl: string): Promise<WordpressFingerprint> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/fingerprint/wordpress`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ target_url: targetUrl }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || await r.text());
  return r.json();
}

export async function fingerprintGitLab(projectId: string, targetUrl: string): Promise<GitlabFingerprint> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/fingerprint/gitlab`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ target_url: targetUrl }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || await r.text());
  return r.json();
}

// ── Source-revision tracking (silent-patch regression hunting) ──────────────────

export type SourceRevision = {
  id: string; source_id: string; revision: string; parent_revision: string | null;
  ref: string | null; authored_at: string | null; created_at: string;
};

export type RevisionDiff = {
  id: string; source_id: string; from_revision: string; to_revision: string;
  files_changed: string[]; summary: string | null; security_relevant: number;
  advisory_id: string | null; created_at: string;
};

export type Source = {
  id: string; project_id: string | null; engagement_id: string | null;
  kind: string; identifier: string; label: string | null;
  observed_revision: string | null; updated_at: string;
  revisions?: SourceRevision[]; diffs?: RevisionDiff[];
};

export type RegressionCandidate = RevisionDiff & {
  identifier: string; kind: string; observed_revision: string;
  project_id: string | null; reason: string;
};

export async function fetchSources(projectId?: string): Promise<Source[]> {
  const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  const r = await fetch(`/api/v1/sources${q}`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchSource(sourceId: string): Promise<Source | null> {
  const r = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}`, { headers: headers() });
  return r.ok ? r.json() : null;
}

export async function registerSource(body: {
  kind: string; identifier: string; project_id?: string | null;
  label?: string | null; observed_revision?: string | null;
}): Promise<Source> {
  const r = await fetch("/api/v1/sources", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function setObservedRevision(sourceId: string, revision: string): Promise<Source> {
  const r = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/observed-revision`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ revision }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function addRevision(sourceId: string, body: {
  revision: string; parent_revision?: string | null; ref?: string | null; authored_at?: string | null;
}): Promise<void> {
  const r = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/revisions`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function recordDiff(sourceId: string, body: {
  from_revision: string; to_revision: string; files_changed?: string[];
  summary?: string | null; security_relevant?: boolean; advisory_id?: string | null;
}): Promise<void> {
  const r = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/diffs`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function fetchRegressionCandidates(opts?: { projectId?: string; sourceId?: string }): Promise<RegressionCandidate[]> {
  const q = new URLSearchParams();
  if (opts?.projectId) q.set("project_id", opts.projectId);
  if (opts?.sourceId) q.set("source_id", opts.sourceId);
  const qs = q.toString();
  const r = await fetch(`/api/v1/sources/regression-candidates${qs ? `?${qs}` : ""}`, { headers: headers() });
  return r.ok ? r.json() : [];
}

// ── Research memory ─────────────────────────────────────────────────────────────

export type MemorySuggestion = {
  id: string; project_id: string | null; profile_id: string;
  title: string; lesson: string; technology_tags: string[];
  status: string; created_at: string;
};

export type MemoryHit = {
  id: string; title: string; lesson: string; technology_tags: string[];
  score: number; match_reason: string[]; approved_at: string;
};

export async function fetchMemorySuggestions(status = "pending"): Promise<MemorySuggestion[]> {
  const r = await fetch(`/api/v1/memory/suggestions?status=${encodeURIComponent(status)}`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function decideMemorySuggestion(
  suggestionId: string,
  body: { decision: "approved" | "rejected"; title?: string; lesson?: string; technology_tags?: string[] },
): Promise<void> {
  const r = await fetch(`/api/v1/memory/suggestions/${encodeURIComponent(suggestionId)}`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function searchMemory(q: string, profileId = "bug-bounty", projectId?: string): Promise<MemoryHit[]> {
  const params = new URLSearchParams({ q, profile_id: profileId });
  if (projectId) params.set("project_id", projectId);
  const r = await fetch(`/api/v1/memory/search?${params.toString()}`, { headers: headers() });
  if (!r.ok) return [];
  const data = await r.json();
  return data.results ?? [];
}

// ── Attack-surface monitoring ───────────────────────────────────────────────────

export type SurfaceDrift = {
  added: string[]; removed: string[]; current_count: number;
  baseline: boolean; compared: boolean; from?: string; to?: string;
};

export async function fetchSurfaceDrift(projectId: string): Promise<SurfaceDrift | null> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/surface/drift`, { headers: headers() });
  return r.ok ? r.json() : null;
}

export async function takeSurfaceSnapshot(projectId: string): Promise<{ id: string; host_count: number; created_at: string }> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/surface/snapshot`, {
    method: "POST", headers: headers(),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export type ScheduledJob = {
  id: string; kind: string; project_id: string | null; engagement_id: string | null;
  spec: Record<string, unknown>; interval_seconds: number; enabled: number;
  next_run_at: string; last_run_at: string | null; last_status: string | null;
};

export async function fetchScheduledJobs(): Promise<ScheduledJob[]> {
  const r = await fetch("/api/v1/scheduler/jobs", { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function createScheduledJob(body: {
  kind: string; interval_seconds: number; spec: Record<string, unknown>;
  project_id?: string | null;
}): Promise<ScheduledJob> {
  const r = await fetch("/api/v1/scheduler/jobs", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function setScheduledJobEnabled(jobId: string, enabled: boolean): Promise<void> {
  await fetch(`/api/v1/scheduler/jobs/${encodeURIComponent(jobId)}/enabled?enabled=${enabled}`, {
    method: "POST", headers: headers(),
  });
}

export async function deleteScheduledJob(jobId: string): Promise<void> {
  await fetch(`/api/v1/scheduler/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", headers: headers() });
}

export async function runDueJobs(): Promise<{ ran: number; results: unknown[] }> {
  const r = await fetch("/api/v1/scheduler/run-due", { method: "POST", headers: headers() });
  return r.ok ? r.json() : { ran: 0, results: [] };
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

// ── Methodology cockpit — taxonomy coverage, chains, engines ─────────────────────

export type TaxFamily = { num: number; name: string; owasp: string | null; money_rank: number | null; note: string | null };

export type CoverageClass = {
  id: string; family_num: number; name: string; priority: string; payout_rank: number;
  cwe: string | null; signal: string | null; informational_only: number; chain_component: number;
  status: "none" | "partial" | "covered"; evidence_ids: string[]; note: string | null; updated_at: string | null;
};

export type CoverageSummary = {
  total: number; by_status: Record<string, number>;
  families: Array<{ family_num: number; total: number; covered: number }>;
};

export type CoverageResponse = { summary: CoverageSummary; classes: CoverageClass[] };

export type ChainComponent = { text: string; class_id: string | null; manual: boolean; have: boolean };
export type Chain = {
  id: string; name: string; result_impact: string; result_priority: string;
  components: ChainComponent[]; have: number; total: number; ready: boolean; missing: string[];
};

export type Engine = {
  key: string; name: string; kind: string; optional: boolean; description: string;
  covers_count: number; covers: Array<{ class_id: string; family: number; name: string }>;
};

export type Checklist = { reporting_checklist: string[]; informational_standalone: string[] };

export async function fetchTaxonomyFamilies(): Promise<TaxFamily[]> {
  const r = await fetch(`/api/v1/taxonomy/families`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchProjectCoverage(projectId: string): Promise<CoverageResponse | null> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/coverage`, { headers: headers() });
  return r.ok ? r.json() : null;
}

export async function fetchProjectChains(projectId: string): Promise<Chain[]> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/chains`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchEngines(): Promise<Engine[]> {
  const r = await fetch(`/api/v1/engines`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function fetchEngagements(projectId: string): Promise<EngagementSummary[]> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/engagements`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function setEngagementAutonomy(
  engagementId: string, autonomy: "guided" | "balanced" | "autonomous",
): Promise<EngagementSummary> {
  const r = await fetch(`/api/v1/engagements/${encodeURIComponent(engagementId)}/autonomy`, {
    method: "PATCH",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ autonomy }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || (await r.text()));
  return r.json();
}

export async function fetchTaxonomyChecklist(): Promise<Checklist | null> {
  const r = await fetch(`/api/v1/taxonomy/checklist`, { headers: headers() });
  return r.ok ? r.json() : null;
}

export async function setCoverage(
  projectId: string, classId: string, status: "none" | "partial" | "covered",
  evidenceIds: string[] = [], note?: string | null,
): Promise<void> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/coverage/${encodeURIComponent(classId)}`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ status, evidence_ids: evidenceIds, note: note ?? null }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || (await r.text()));
}

export type Methodology = {
  class_id: string; class_name: string; family_num: number;
  has_methodology: boolean; steps: string[]; ai_hook: string | null;
};

export async function fetchMethodology(classId: string): Promise<Methodology | null> {
  const r = await fetch(`/api/v1/taxonomy/classes/${encodeURIComponent(classId)}/methodology`, { headers: headers() });
  return r.ok ? r.json() : null;
}

// ── WSTG v4.2 coverage axis ──────────────────────────────────────────────────────

export type WstgTestCov = {
  id: string; chapter: string; num: number; title: string;
  status: "none" | "partial" | "covered"; mapped: boolean;
  class_ids: string[]; evidence_ids: string[];
};
export type WstgChapterCov = {
  code: string; name: string; total: number; mapped: number; covered: number; partial: number;
};
export type WstgCoverage = {
  total: number; mapped: number; catalog_only: number; covered: number; partial: number;
  chapters: WstgChapterCov[]; tests: WstgTestCov[];
};

export type WstgCatalogTest = {
  id: string; chapter: string; num: number; title: string;
  how_to_test: string; evidence: string; reject_if: string;
  maps: Array<{ class_id: string; name: string }>;
};
export type WstgCatalog = {
  total: number; chapters: Array<{ code: string; name: string; count: number }>; tests: WstgCatalogTest[];
};

export async function fetchWstgCatalog(): Promise<WstgCatalog | null> {
  const r = await fetch(`/api/v1/wstg/catalog`, { headers: headers() });
  return r.ok ? r.json() : null;
}

export async function fetchWstgCoverage(projectId: string): Promise<WstgCoverage | null> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/wstg/coverage`, { headers: headers() });
  return r.ok ? r.json() : null;
}

// ── JS full-diff ─────────────────────────────────────────────────────────────────

export type JsTracked = {
  url: string; revisions: number; last_seen: string; hash: string; size: number;
  endpoint_count: number; secret_count: number;
};
export type JsSecret = { kind: string; match: string };
export type JsDiff = {
  url: string; from: { hash: string; fetched_at: string }; to: { hash: string; fetched_at: string };
  added_endpoints: string[]; removed_endpoints: string[]; added_secrets: JsSecret[];
  unified_diff: string[]; unified_diff_truncated: boolean;
};

export async function fetchJsTracked(projectId: string): Promise<JsTracked[]> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/js/tracked`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function snapshotJs(projectId: string, urls: string[]): Promise<{ snapshots: any[]; changed: number }> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/js/snapshot`, {
    method: "POST", headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || (await r.text()));
  return r.json();
}

export async function fetchJsDiff(projectId: string, url: string): Promise<JsDiff | null> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/js/diff?url=${encodeURIComponent(url)}`, { headers: headers() });
  return r.ok ? r.json() : null;
}

// ── Visual recon (screenshots) ─────────────────────────────────────────────────────

export type Screenshot = {
  id: string; url: string; title: string | null; width: number; height: number;
  status: string; error: string | null; captured_at: string;
};

export async function fetchScreenshots(projectId: string): Promise<Screenshot[]> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/screenshots`, { headers: headers() });
  return r.ok ? r.json() : [];
}

export async function captureScreenshots(
  projectId: string, urls: string[], backend: "auto" | "chromium" | "gowitness" = "auto",
): Promise<{ captured: number; results: any[] }> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/screenshots`, {
    method: "POST", headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ urls, backend }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || (await r.text()));
  return r.json();
}

// The image endpoint needs an auth header, so fetch it as a blob and hand back an object URL.
export async function fetchScreenshotImage(projectId: string, shotId: string): Promise<string | null> {
  const r = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/screenshots/${encodeURIComponent(shotId)}/image`, { headers: headers() });
  if (!r.ok) return null;
  return URL.createObjectURL(await r.blob());
}
