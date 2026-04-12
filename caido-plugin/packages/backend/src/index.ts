import type { SDK, DefineAPI, DefineEvents } from "caido:plugin";

// ── Types ───────────────────────────────────────────────────

interface ScopeRule {
  id: number;
  pattern: string;      // glob or regex for hostname
  type: "include" | "exclude";
  active: boolean;
}

interface Finding {
  id: number;
  requestId: string;
  title: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  description: string;
  evidence: string;
  url: string;
  method: string;
  timestamp: string;
  exported: boolean;
}

interface ScopeCheckResult {
  inScope: boolean;
  matchedRule: string | null;
}

interface AnalysisResult {
  summary: string;
  findings: string[];
  severity: "info" | "low" | "medium" | "high" | "critical";
  recommendations: string[];
}

type AIProvider = "claude" | "ollama";

// ── Database ────────────────────────────────────────────────

async function initDatabase(sdk: SDK) {
  const db = await sdk.meta.db();

  db.exec(`
    CREATE TABLE IF NOT EXISTS scope_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'include',
      active INTEGER NOT NULL DEFAULT 1
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT,
      title TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      description TEXT,
      evidence TEXT,
      url TEXT,
      method TEXT,
      timestamp TEXT NOT NULL,
      exported INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Default settings
  const stmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  stmt.run("scope_enforcement", "warn");           // "warn" | "off"
  stmt.run("ai_provider", "ollama");               // "claude" | "ollama"
  // Claude
  stmt.run("claude_api_key", "");                  // sk-ant-...
  stmt.run("claude_model", "claude-sonnet-4-20250514");
  stmt.run("claude_endpoint", "https://api.anthropic.com/v1/messages");
  // Ollama
  stmt.run("ollama_endpoint", "http://localhost:11434");
  stmt.run("ollama_model", "llama3.1");            // whatever you have pulled
  // Export
  stmt.run("obsidian_vault_path", "/vault");
}

// ── Scope Enforcement ───────────────────────────────────────

function matchesPattern(hostname: string, pattern: string): boolean {
  // Support glob-style wildcards: *.example.com
  const regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*");
  return new RegExp(`^${regex}$`, "i").test(hostname);
}

async function checkScope(sdk: SDK, url: string): Promise<ScopeCheckResult> {
  const db = await sdk.meta.db();
  const hostname = new URL(url).hostname;

  const rules = db.prepare(
    "SELECT * FROM scope_rules WHERE active = 1 ORDER BY type ASC"
  ).all() as ScopeRule[];

  // Excludes take priority
  for (const rule of rules) {
    if (rule.type === "exclude" && matchesPattern(hostname, rule.pattern)) {
      return { inScope: false, matchedRule: rule.pattern };
    }
  }

  // Then check includes
  const includes = rules.filter((r) => r.type === "include");
  if (includes.length === 0) return { inScope: true, matchedRule: null };

  for (const rule of includes) {
    if (matchesPattern(hostname, rule.pattern)) {
      return { inScope: true, matchedRule: rule.pattern };
    }
  }

  return { inScope: false, matchedRule: null };
}

// ── Scope Rule CRUD ─────────────────────────────────────────

async function getScopeRules(sdk: SDK): Promise<ScopeRule[]> {
  const db = await sdk.meta.db();
  return db.prepare("SELECT * FROM scope_rules ORDER BY type, pattern").all() as ScopeRule[];
}

async function addScopeRule(
  sdk: SDK,
  pattern: string,
  type: "include" | "exclude"
): Promise<ScopeRule> {
  const db = await sdk.meta.db();
  const stmt = db.prepare("INSERT INTO scope_rules (pattern, type) VALUES (?, ?)");
  const result = stmt.run(pattern, type);
  const id = Number(result.lastInsertRowid);
  sdk.console.log(`[Prowlr] Scope rule added: ${type} ${pattern}`);
  return { id, pattern, type, active: true };
}

async function removeScopeRule(sdk: SDK, id: number): Promise<void> {
  const db = await sdk.meta.db();
  db.prepare("DELETE FROM scope_rules WHERE id = ?").run(id);
}

async function toggleScopeRule(sdk: SDK, id: number): Promise<void> {
  const db = await sdk.meta.db();
  db.prepare("UPDATE scope_rules SET active = NOT active WHERE id = ?").run(id);
}

// ── AI Analysis ─────────────────────────────────────────────

function getSettings(db: any): Record<string, string> {
  return Object.fromEntries(
    (db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[])
      .map((r) => [r.key, r.value])
  );
}

const ANALYSIS_PROMPT = `You are a web security analyst reviewing HTTP traffic from a bug bounty engagement. Analyze this request/response pair for vulnerabilities.

REQUEST:
{REQUEST}

RESPONSE (first 4000 chars):
{RESPONSE}

Respond ONLY in JSON format (no markdown, no explanation outside the JSON):
{
  "summary": "one-line description of what this endpoint does",
  "findings": ["list of potential vulnerabilities or interesting behaviors"],
  "severity": "info|low|medium|high|critical",
  "recommendations": ["next steps to test/confirm each finding"]
}`;

async function callClaude(
  settings: Record<string, string>,
  prompt: string
): Promise<string> {
  const apiKey = settings.claude_api_key;
  if (!apiKey) throw new Error("Claude API key not set — go to Prowlr settings");

  const endpoint = settings.claude_endpoint || "https://api.anthropic.com/v1/messages";
  const model = settings.claude_model || "claude-sonnet-4-20250514";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || "{}";
}

async function callOllama(
  settings: Record<string, string>,
  prompt: string
): Promise<string> {
  const endpoint = settings.ollama_endpoint || "http://localhost:11434";
  const model = settings.ollama_model || "llama3.1";

  const res = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  return data.response || "{}";
}

async function testAIConnection(sdk: SDK): Promise<string> {
  const db = await sdk.meta.db();
  const settings = getSettings(db);
  const provider = settings.ai_provider || "ollama";

  try {
    if (provider === "ollama") {
      const endpoint = settings.ollama_endpoint || "http://localhost:11434";
      const res = await fetch(`${endpoint}/api/tags`);
      if (!res.ok) throw new Error(`Ollama unreachable at ${endpoint}`);
      const data = await res.json();
      const models = (data.models || []).map((m: any) => m.name).join(", ");
      return `Ollama OK — models: ${models || "none (pull one with: ollama pull llama3.1)"}`;
    } else {
      const apiKey = settings.claude_api_key;
      if (!apiKey) return "Claude API key not set";
      // Minimal request to verify auth
      const endpoint = settings.claude_endpoint || "https://api.anthropic.com/v1/messages";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: settings.claude_model || "claude-sonnet-4-20250514",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Claude auth failed (${res.status}): ${err.substring(0, 100)}`;
      }
      return `Claude OK — model: ${settings.claude_model || "claude-sonnet-4-20250514"}`;
    }
  } catch (err) {
    return `Connection failed: ${err}`;
  }
}

async function getOllamaModels(sdk: SDK): Promise<string[]> {
  const db = await sdk.meta.db();
  const settings = getSettings(db);
  const endpoint = settings.ollama_endpoint || "http://localhost:11434";

  try {
    const res = await fetch(`${endpoint}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m: any) => m.name);
  } catch {
    return [];
  }
}

async function analyzeRequest(sdk: SDK, requestId: string): Promise<AnalysisResult> {
  const db = await sdk.meta.db();
  const settings = getSettings(db);
  const provider = (settings.ai_provider || "ollama") as AIProvider;

  const result = await sdk.requests.get(requestId);
  if (!result) {
    return { summary: "Request not found", findings: [], severity: "info", recommendations: [] };
  }

  const { request, response } = result;
  const reqRaw = request.toSpecRaw().getRaw();
  const reqText = new TextDecoder().decode(reqRaw);
  const resText = response ? new TextDecoder().decode(response.getRaw()) : "(no response)";

  const prompt = ANALYSIS_PROMPT
    .replace("{REQUEST}", reqText.substring(0, 4000))
    .replace("{RESPONSE}", resText.substring(0, 4000));

  try {
    const content = provider === "claude"
      ? await callClaude(settings, prompt)
      : await callOllama(settings, prompt);

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as AnalysisResult;
    }

    return { summary: content, findings: [], severity: "info", recommendations: [] };
  } catch (err) {
    sdk.console.error(`[Prowlr] ${provider} analysis failed: ${err}`);
    return {
      summary: `${provider} failed: ${err}`,
      findings: [],
      severity: "info",
      recommendations: [],
    };
  }
}

// ── Findings ────────────────────────────────────────────────

async function saveAnalysisAsFinding(
  sdk: SDK,
  requestId: string,
  analysis: AnalysisResult
): Promise<Finding> {
  const db = await sdk.meta.db();
  const result = await sdk.requests.get(requestId);
  const url = result ? new URL(
    new TextDecoder().decode(result.request.toSpecRaw().getRaw()).split("\n")[0]?.split(" ")[1] || "/",
    "https://unknown"
  ).toString() : "unknown";
  const method = result
    ? new TextDecoder().decode(result.request.toSpecRaw().getRaw()).split(" ")[0] || "GET"
    : "GET";

  const timestamp = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO findings (request_id, title, severity, description, evidence, url, method, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertResult = stmt.run(
    requestId,
    analysis.summary,
    analysis.severity,
    analysis.findings.join("\n"),
    analysis.recommendations.join("\n"),
    url,
    method,
    timestamp
  );

  const id = Number(insertResult.lastInsertRowid);
  sdk.console.log(`[Prowlr] Finding saved: ${analysis.summary}`);

  return {
    id,
    requestId,
    title: analysis.summary,
    severity: analysis.severity,
    description: analysis.findings.join("\n"),
    evidence: analysis.recommendations.join("\n"),
    url,
    method,
    timestamp,
    exported: false,
  };
}

async function getFindings(sdk: SDK): Promise<Finding[]> {
  const db = await sdk.meta.db();
  return db.prepare("SELECT * FROM findings ORDER BY timestamp DESC").all() as Finding[];
}

async function deleteFinding(sdk: SDK, id: number): Promise<void> {
  const db = await sdk.meta.db();
  db.prepare("DELETE FROM findings WHERE id = ?").run(id);
}

// ── Obsidian Export ─────────────────────────────────────────

function findingToObsidian(finding: Finding): string {
  return `---
tags: [finding, ${finding.severity}, caido]
severity: ${finding.severity}
url: ${finding.url}
method: ${finding.method}
date: ${finding.timestamp.split("T")[0]}
---

# ${finding.title}

## Details
- **URL:** \`${finding.url}\`
- **Method:** \`${finding.method}\`
- **Severity:** ${finding.severity.toUpperCase()}
- **Found:** ${finding.timestamp}
- **Request ID:** ${finding.requestId}

## Description
${finding.description}

## Evidence / Next Steps
${finding.evidence}

## Reproduction
1. Open Caido
2. Navigate to request ID \`${finding.requestId}\`
3. Replay the request to confirm

## Notes

`;
}

async function exportFindingsToObsidian(sdk: SDK): Promise<string> {
  const findings = await getFindings(sdk);
  const unexported = findings.filter((f) => !f.exported);

  if (unexported.length === 0) return "No new findings to export.";

  const db = await sdk.meta.db();
  const exportDir = "/home/hunter/exports/findings";
  const exported: string[] = [];

  for (const finding of unexported) {
    const markdown = findingToObsidian(finding);
    const filename = `finding-${finding.id}-${finding.severity}-${finding.timestamp.split("T")[0]}.md`;
    exported.push(`${filename}: ${finding.title}`);
    db.prepare("UPDATE findings SET exported = 1 WHERE id = ?").run(finding.id);
  }

  // Write files to the export volume via shell — Caido SDK has no fs API
  // The export volume is writable and persists across restarts
  const { execSync } = await import("child_process");
  try {
    execSync(`mkdir -p ${exportDir}`);
    for (let i = 0; i < unexported.length; i++) {
      const finding = unexported[i];
      const markdown = findingToObsidian(finding);
      const filename = `finding-${finding.id}-${finding.severity}-${finding.timestamp.split("T")[0]}.md`;
      const escapedContent = markdown.replace(/'/g, "'\\''");
      execSync(`cat > '${exportDir}/${filename}' << 'PROWLR_EOF'\n${markdown}\nPROWLR_EOF`);
    }
    sdk.console.log(`[Prowlr] Exported ${unexported.length} findings to ${exportDir}`);
    return `Exported ${unexported.length} findings to ${exportDir}:\n${exported.join("\n")}`;
  } catch (err) {
    sdk.console.log(`[Prowlr] Export write failed: ${err}`);
    // Fallback: return markdown content for manual save
    const result = unexported.map(findingToObsidian).join("\n---\n\n");
    return `Write failed — copy manually:\n\n${result}`;
  }
}

// ── Settings ────────────────────────────────────────────────

async function getSetting(sdk: SDK, key: string): Promise<string> {
  const db = await sdk.meta.db();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value || "";
}

async function setSetting(sdk: SDK, key: string, value: string): Promise<void> {
  const db = await sdk.meta.db();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  sdk.console.log(`[Prowlr] Setting updated: ${key}`);
}

// ── API Definition ──────────────────────────────────────────

export type API = DefineAPI<{
  // Scope
  checkScope: typeof checkScope;
  getScopeRules: typeof getScopeRules;
  addScopeRule: typeof addScopeRule;
  removeScopeRule: typeof removeScopeRule;
  toggleScopeRule: typeof toggleScopeRule;
  // AI
  analyzeRequest: typeof analyzeRequest;
  testAIConnection: typeof testAIConnection;
  getOllamaModels: typeof getOllamaModels;
  // Findings
  saveAnalysisAsFinding: typeof saveAnalysisAsFinding;
  getFindings: typeof getFindings;
  deleteFinding: typeof deleteFinding;
  exportFindingsToObsidian: typeof exportFindingsToObsidian;
  // Settings
  getSetting: typeof getSetting;
  setSetting: typeof setSetting;
}>;

export type BackendEvents = DefineEvents<{
  "scope:violation": (url: string, rule: string | null) => void;
  "finding:created": (finding: Finding) => void;
}>;

// ── Init ────────────────────────────────────────────────────

export async function init(sdk: SDK<API, BackendEvents>) {
  await initDatabase(sdk);

  // Register all API functions
  sdk.api.register("checkScope", checkScope);
  sdk.api.register("getScopeRules", getScopeRules);
  sdk.api.register("addScopeRule", addScopeRule);
  sdk.api.register("removeScopeRule", removeScopeRule);
  sdk.api.register("toggleScopeRule", toggleScopeRule);
  sdk.api.register("analyzeRequest", analyzeRequest);
  sdk.api.register("testAIConnection", testAIConnection);
  sdk.api.register("getOllamaModels", getOllamaModels);
  sdk.api.register("saveAnalysisAsFinding", saveAnalysisAsFinding);
  sdk.api.register("getFindings", getFindings);
  sdk.api.register("deleteFinding", deleteFinding);
  sdk.api.register("exportFindingsToObsidian", exportFindingsToObsidian);
  sdk.api.register("getSetting", getSetting);
  sdk.api.register("setSetting", setSetting);

  sdk.console.log("[Prowlr] Backend initialized");
}
