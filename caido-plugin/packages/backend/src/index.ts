import type { SDK, DefineAPI, DefineEvents } from "caido:plugin";

// ── Types ───────────────────────────────────────────────────

interface ScopeRule {
  id: number;
  pattern: string;
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

const VALID_SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);

const DEFAULT_ANALYSIS_PROMPT = `You are a web security analyst reviewing HTTP traffic from a bug bounty engagement. Analyze this request/response pair for vulnerabilities.

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

// ── Helpers ────────────────────────────────────────────────

function sanitizeError(msg: string): string {
  return msg.replace(/sk-ant-[a-zA-Z0-9_-]+/g, "sk-ant-***");
}

function validateEndpoint(url: string, type: "claude" | "ollama"): boolean {
  try {
    const parsed = new URL(url);
    if (type === "claude") {
      return parsed.protocol === "https:" && parsed.hostname.endsWith("anthropic.com");
    }
    // Ollama: allow localhost, 127.0.0.1, host.docker.internal, or any custom host
    const allowed = ["localhost", "127.0.0.1", "host.docker.internal"];
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateAnalysisResult(raw: unknown): AnalysisResult {
  const fallback: AnalysisResult = { summary: "", findings: [], severity: "info", recommendations: [] };
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;

  return {
    summary: typeof obj.summary === "string" ? obj.summary.substring(0, 500) : "",
    findings: Array.isArray(obj.findings)
      ? obj.findings.filter((f): f is string => typeof f === "string").map((f) => f.substring(0, 1000))
      : [],
    severity: typeof obj.severity === "string" && VALID_SEVERITIES.has(obj.severity)
      ? (obj.severity as AnalysisResult["severity"])
      : "info",
    recommendations: Array.isArray(obj.recommendations)
      ? obj.recommendations.filter((r): r is string => typeof r === "string").map((r) => r.substring(0, 1000))
      : [],
  };
}

function getSettings(db: any): Record<string, string> {
  return Object.fromEntries(
    (db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[])
      .map((r: { key: string; value: string }) => [r.key, r.value])
  );
}

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

  // Default settings — INSERT OR IGNORE so user changes persist
  const stmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  // Scope
  stmt.run("scope_enforcement", "warn");
  // AI provider
  stmt.run("ai_provider", "ollama");
  // Claude
  stmt.run("claude_api_key", "");
  stmt.run("claude_model", "claude-sonnet-4-20250514");
  stmt.run("claude_endpoint", "https://api.anthropic.com/v1/messages");
  stmt.run("claude_max_tokens", "2048");
  stmt.run("claude_api_version", "2023-06-01");
  // Ollama
  stmt.run("ollama_endpoint", "http://localhost:11434");
  stmt.run("ollama_model", "llama3.1");
  // Export
  stmt.run("export_path", "/home/hunter/exports/findings");
  // Terminal
  stmt.run("terminal_timeout", "300");
  stmt.run("terminal_cwd", "");
  // AI prompt (customizable)
  stmt.run("ai_analysis_prompt", "");
  // Quick commands (JSON array, empty = use defaults)
  stmt.run("quick_commands", "");
  // Guardrails (NemoClaw-style filters for prompt injection + output leakage)
  stmt.run("guardrails_enabled", "true");
  // AI rate limit (per provider, per minute)
  stmt.run("ai_rate_limit_per_min", "20");
}

// ── Scope Enforcement ───────────────────────────────────────

function matchesPattern(hostname: string, pattern: string): boolean {
  try {
    // Escape all regex metacharacters except *, then convert * to .*
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(hostname);
  } catch {
    return false;
  }
}

async function checkScope(sdk: SDK, url: string): Promise<ScopeCheckResult> {
  const db = await sdk.meta.db();

  // Check if scope enforcement is enabled
  const settings = getSettings(db);
  if (settings.scope_enforcement === "off") {
    return { inScope: true, matchedRule: null };
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { inScope: false, matchedRule: null };
  }

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
  // Input validation
  if (!pattern || pattern.length > 256) {
    throw new Error("Pattern must be 1-256 characters");
  }
  if (type !== "include" && type !== "exclude") {
    throw new Error("Type must be 'include' or 'exclude'");
  }

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

// ── NemoClaw-style Guardrails ───────────────────────────────
// Defensive filters for AI prompt injection + response leakage.
// Togglable via `guardrails_enabled` setting (default: on).

const INJECTION_PATTERNS = [
  /ignore (?:all |the )?(?:previous|prior|above) (?:instructions?|prompts?|rules?)/i,
  /disregard (?:all |your )?(?:instructions?|system prompt)/i,
  /you are (?:now )?(?:a |an )?(?:dan|evil|unrestricted|jailbroken)/i,
  /system\s*prompt\s*[:=]/i,
  /<\|im_start\|>|<\|im_end\|>/,
  /\[\[\s*SYSTEM\s*\]\]/i,
  // Caido request bodies can legitimately contain "```"; only flag with verb context
  /```(?:system|instructions?)\s*\n/i,
];

// Secret patterns to redact from AI output before display
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[a-zA-Z0-9_-]{20,}/g, "sk-ant-***"],
  [/sk-[a-zA-Z0-9]{32,}/g, "sk-***"],
  [/AKIA[0-9A-Z]{16}/g, "AKIA***"],
  [/ghp_[a-zA-Z0-9]{30,}/g, "ghp_***"],
  [/gho_[a-zA-Z0-9]{30,}/g, "gho_***"],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[JWT-REDACTED]"],
];

function sanitizePromptInput(text: string, enabled: boolean): { text: string; flagged: boolean } {
  if (!enabled) return { text, flagged: false };
  let flagged = false;
  let out = text;
  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(out)) {
      flagged = true;
      out = out.replace(pat, "[FILTERED-INJECTION]");
    }
  }
  return { text: out, flagged };
}

function sanitizeAIOutput(text: string, enabled: boolean): string {
  if (!enabled) return text;
  let out = text;
  for (const [pat, repl] of SECRET_PATTERNS) {
    out = out.replace(pat, repl);
  }
  return out;
}

// ── Rate Limiter ────────────────────────────────────────────
// Sliding window per provider. Default: 20 calls/min, configurable via settings.
const rateWindow: Record<string, number[]> = { claude: [], ollama: [] };

function checkRateLimit(provider: AIProvider, settings: Record<string, string>): void {
  const limit = Math.max(1, parseInt(settings.ai_rate_limit_per_min || "20", 10) || 20);
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = rateWindow[provider];
  // drop entries older than window
  while (bucket.length && now - bucket[0]! > windowMs) bucket.shift();
  if (bucket.length >= limit) {
    const retryIn = Math.ceil((windowMs - (now - bucket[0]!)) / 1000);
    throw new Error(`AI rate limit: ${limit}/min reached for ${provider} — retry in ${retryIn}s`);
  }
  bucket.push(now);
}

// ── AI Analysis ─────────────────────────────────────────────

async function callClaude(
  settings: Record<string, string>,
  prompt: string
): Promise<string> {
  const apiKey = settings.claude_api_key;
  if (!apiKey) throw new Error("Claude API key not set — go to Prowlr settings");

  checkRateLimit("claude", settings);

  const endpoint = settings.claude_endpoint || "https://api.anthropic.com/v1/messages";
  if (!validateEndpoint(endpoint, "claude")) {
    throw new Error("Invalid Claude endpoint — must be https://*.anthropic.com");
  }

  const model = settings.claude_model || "claude-sonnet-4-20250514";
  const maxTokens = parseInt(settings.claude_max_tokens || "2048", 10) || 2048;
  const apiVersion = settings.claude_api_version || "2023-06-01";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": apiVersion,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = sanitizeError(await res.text());
    throw new Error(`Claude ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || "{}";
}

async function callOllama(
  settings: Record<string, string>,
  prompt: string
): Promise<string> {
  checkRateLimit("ollama", settings);

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
      const endpoint = settings.claude_endpoint || "https://api.anthropic.com/v1/messages";
      if (!validateEndpoint(endpoint, "claude")) return "Invalid Claude endpoint";
      const apiVersion = settings.claude_api_version || "2023-06-01";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": apiVersion,
        },
        body: JSON.stringify({
          model: settings.claude_model || "claude-sonnet-4-20250514",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const err = sanitizeError(await res.text());
        return `Claude auth failed (${res.status}): ${err.substring(0, 100)}`;
      }
      return `Claude OK — model: ${settings.claude_model || "claude-sonnet-4-20250514"}`;
    }
  } catch (err) {
    return `Connection failed: ${sanitizeError(String(err))}`;
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

  // Guardrails: filter prompt injection attempts from captured traffic before sending to AI
  const guardrailsOn = (settings.guardrails_enabled ?? "true") !== "false";
  const cleanReq = sanitizePromptInput(reqText.substring(0, 4000), guardrailsOn);
  const cleanRes = sanitizePromptInput(resText.substring(0, 4000), guardrailsOn);

  // Use custom prompt if set, otherwise default
  const promptTemplate = settings.ai_analysis_prompt || DEFAULT_ANALYSIS_PROMPT;
  const prompt = promptTemplate
    .replace("{REQUEST}", cleanReq.text)
    .replace("{RESPONSE}", cleanRes.text);

  try {
    let content = provider === "claude"
      ? await callClaude(settings, prompt)
      : await callOllama(settings, prompt);

    // Redact any secrets the AI may have echoed from the traffic
    content = sanitizeAIOutput(content, guardrailsOn);

    const injectionFlagged = cleanReq.flagged || cleanRes.flagged;
    if (injectionFlagged) {
      sdk.console.log("[Prowlr guardrails] prompt-injection pattern filtered from traffic before AI call");
    }

    // Parse and validate AI output — never trust raw JSON.parse
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    let result: AnalysisResult;
    if (jsonMatch) {
      try {
        result = validateAnalysisResult(JSON.parse(jsonMatch[0]));
      } catch {
        result = { summary: content.substring(0, 500), findings: [], severity: "info", recommendations: [] };
      }
    } else {
      result = { summary: content.substring(0, 500), findings: [], severity: "info", recommendations: [] };
    }

    if (injectionFlagged) {
      result.findings = ["[guardrail] prompt-injection pattern detected in traffic — filtered before AI", ...result.findings];
    }
    return result;
  } catch (err) {
    sdk.console.error(`[Prowlr] ${provider} analysis failed: ${sanitizeError(String(err))}`);
    return {
      summary: `${provider} failed: ${sanitizeError(String(err))}`,
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

  // Validate severity again at persistence layer
  const safeSeverity = VALID_SEVERITIES.has(analysis.severity) ? analysis.severity : "info";

  const insertResult = stmt.run(
    requestId,
    analysis.summary,
    safeSeverity,
    analysis.findings.join("\n"),
    analysis.recommendations.join("\n"),
    url,
    method,
    timestamp
  );

  const id = Number(insertResult.lastInsertRowid);
  sdk.console.log(`[Prowlr] Finding saved: ${analysis.summary.substring(0, 100)}`);

  return {
    id,
    requestId,
    title: analysis.summary,
    severity: safeSeverity as Finding["severity"],
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
  const settings = getSettings(db);
  const exportDir = settings.export_path || "/home/hunter/exports/findings";
  const exported: string[] = [];

  const { mkdirSync, writeFileSync } = await import("fs");
  const { join } = await import("path");

  try {
    mkdirSync(exportDir, { recursive: true });

    for (const finding of unexported) {
      const markdown = findingToObsidian(finding);
      const safeSeverity = (finding.severity || "info").replace(/[^a-z]/gi, "");
      const safeDate = (finding.timestamp || "").split("T")[0].replace(/[^0-9-]/g, "");
      const filename = `finding-${finding.id}-${safeSeverity}-${safeDate}.md`;
      writeFileSync(join(exportDir, filename), markdown, "utf8");
      exported.push(`${filename}: ${finding.title}`);
      db.prepare("UPDATE findings SET exported = 1 WHERE id = ?").run(finding.id);
    }

    sdk.console.log(`[Prowlr] Exported ${unexported.length} findings to ${exportDir}`);
    return `Exported ${unexported.length} findings to ${exportDir}:\n${exported.join("\n")}`;
  } catch (err) {
    sdk.console.log(`[Prowlr] Export write failed: ${sanitizeError(String(err))}`);
    const result = unexported.map(findingToObsidian).join("\n---\n\n");
    return `Write failed — copy manually:\n\n${result}`;
  }
}

// ── Terminal ────────────────────────────────────────────────

const terminalSessions = new Map<string, { proc: any; timeout: any }>();

async function terminalExec(sdk: SDK<API, BackendEvents>, sessionId: string, command: string): Promise<string> {
  // Input validation
  if (!command || command.length > 4096) {
    return "Command must be 1-4096 characters";
  }

  const { spawn } = await import("child_process");
  const db = await sdk.meta.db();
  const settings = getSettings(db);
  const timeoutSec = parseInt(settings.terminal_timeout || "300", 10) || 300;
  const cwd = settings.terminal_cwd || process.env.HOME || "/";

  // Kill existing session if any
  const existing = terminalSessions.get(sessionId);
  if (existing) {
    clearTimeout(existing.timeout);
    try { existing.proc.kill(); } catch {}
    terminalSessions.delete(sessionId);
  }

  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      cwd,
      env: { ...process.env, TERM: "xterm-256color", COLUMNS: "120", LINES: "30" },
    });

    // Store timeout ID so we can clear it on early exit
    const killTimer = setTimeout(() => {
      if (terminalSessions.has(sessionId)) {
        try { proc.kill(); } catch {}
        terminalSessions.delete(sessionId);
        sdk.api.send("terminal:output", sessionId, `\r\n[timed out after ${timeoutSec}s]\r\n`);
        sdk.api.send("terminal:exit", sessionId, 124);
      }
    }, timeoutSec * 1000);

    terminalSessions.set(sessionId, { proc, timeout: killTimer });
    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      sdk.api.send("terminal:output", sessionId, text);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      sdk.api.send("terminal:output", sessionId, text);
    });

    proc.on("close", (code: number | null) => {
      clearTimeout(killTimer);
      terminalSessions.delete(sessionId);
      sdk.api.send("terminal:exit", sessionId, code ?? 0);
      resolve(output);
    });

    proc.on("error", (err: Error) => {
      clearTimeout(killTimer);
      terminalSessions.delete(sessionId);
      sdk.api.send("terminal:output", sessionId, `\r\nError: ${err.message}\r\n`);
      sdk.api.send("terminal:exit", sessionId, 1);
      resolve(`Error: ${err.message}`);
    });
  });
}

async function terminalInput(sdk: SDK, sessionId: string, data: string): Promise<void> {
  const session = terminalSessions.get(sessionId);
  if (session?.proc?.stdin?.writable) {
    session.proc.stdin.write(data);
  }
}

async function terminalKill(sdk: SDK, sessionId: string): Promise<void> {
  const session = terminalSessions.get(sessionId);
  if (session) {
    clearTimeout(session.timeout);
    try { session.proc.kill("SIGTERM"); } catch {}
    terminalSessions.delete(sessionId);
  }
}

// Quick commands — returns user-customized or default set
async function getQuickCommands(sdk: SDK): Promise<Array<{ label: string; cmd: string; icon: string }>> {
  const db = await sdk.meta.db();
  const settings = getSettings(db);
  const custom = settings.quick_commands;

  if (custom) {
    try {
      const parsed = JSON.parse(custom);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }

  // Defaults — user can override via settings
  return [
    { label: "AI Analyze (Ollama)", cmd: "invoke-ollama", icon: "fas fa-robot" },
    { label: "AI Analyze (Claude)", cmd: "invoke-claude", icon: "fas fa-brain" },
    { label: "Harbinger Status", cmd: "harbinger status", icon: "fas fa-satellite-dish" },
    { label: "csbx List", cmd: "csbx list", icon: "fas fa-puzzle-piece" },
    { label: "Nuclei Scan", cmd: "echo 'Usage: nuclei -u <target>'", icon: "fas fa-search" },
    { label: "Subfinder", cmd: "echo 'Usage: subfinder -d <domain>'", icon: "fas fa-globe" },
    { label: "httpx Probe", cmd: "echo 'Usage: httpx -l hosts.txt'", icon: "fas fa-server" },
  ];
}

// ── Settings ────────────────────────────────────────────────

async function getSetting(sdk: SDK, key: string): Promise<string> {
  const db = await sdk.meta.db();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value || "";
}

async function setSetting(sdk: SDK, key: string, value: string): Promise<void> {
  // Validate endpoint settings to prevent SSRF
  if (key === "claude_endpoint") {
    if (value && !validateEndpoint(value, "claude")) {
      throw new Error("Claude endpoint must be https://*.anthropic.com");
    }
  }
  if (key === "ollama_endpoint") {
    if (value && !validateEndpoint(value, "ollama")) {
      throw new Error("Invalid Ollama endpoint URL");
    }
  }
  // Validate numeric settings
  if (key === "claude_max_tokens") {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 1 || n > 32000) {
      throw new Error("max_tokens must be 1-32000");
    }
  }
  if (key === "terminal_timeout") {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 10 || n > 3600) {
      throw new Error("terminal_timeout must be 10-3600 seconds");
    }
  }

  const db = await sdk.meta.db();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  // Never log the value — could contain API keys
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
  // Terminal
  terminalExec: typeof terminalExec;
  terminalInput: typeof terminalInput;
  terminalKill: typeof terminalKill;
  getQuickCommands: typeof getQuickCommands;
}>;

export type BackendEvents = DefineEvents<{
  "scope:violation": (url: string, rule: string | null) => void;
  "finding:created": (finding: Finding) => void;
  "terminal:output": (sessionId: string, data: string) => void;
  "terminal:exit": (sessionId: string, code: number) => void;
}>;

// ── Init ────────────────────────────────────────────────────

export async function init(sdk: SDK<API, BackendEvents>) {
  await initDatabase(sdk);

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
  sdk.api.register("terminalExec", terminalExec);
  sdk.api.register("terminalInput", terminalInput);
  sdk.api.register("terminalKill", terminalKill);
  sdk.api.register("getQuickCommands", getQuickCommands);

  sdk.console.log("[Prowlr] Backend initialized");
}
