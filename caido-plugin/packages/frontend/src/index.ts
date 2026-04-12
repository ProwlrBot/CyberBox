import type { Caido } from "@caido/sdk-frontend";
import type { API, BackendEvents } from "prowlr-backend";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "xterm/css/xterm.css";
import "./styles/style.css";

type ProwlrSDK = Caido<API, BackendEvents>;

const Page = "/prowlr" as const;

const Commands = {
  analyzeRequest: "prowlr.analyze-request",
  checkScope: "prowlr.check-scope",
  exportFindings: "prowlr.export-findings",
} as const;

// ── HTML Escape (prevent XSS) ──────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Page Builder ────────────────────────────────────────────

function buildPage(sdk: ProwlrSDK): HTMLElement {
  const container = document.createElement("div");
  container.className = "prowlr-container";

  container.innerHTML = `
    <div class="prowlr-header">
      <h1>Prowlr</h1>
      <p>Scope enforcement + AI analysis + Obsidian export</p>
    </div>

    <div class="prowlr-tabs">
      <button class="prowlr-tab active" data-tab="scope">Scope</button>
      <button class="prowlr-tab" data-tab="findings">Findings</button>
      <button class="prowlr-tab" data-tab="terminal">Terminal</button>
      <button class="prowlr-tab" data-tab="settings">Settings</button>
    </div>

    <div class="prowlr-panel" id="prowlr-scope">
      <div class="prowlr-scope-form">
        <input type="text" id="prowlr-scope-pattern" placeholder="*.example.com" maxlength="256" />
        <select id="prowlr-scope-type">
          <option value="include">Include</option>
          <option value="exclude">Exclude</option>
        </select>
        <button id="prowlr-scope-add">Add Rule</button>
      </div>
      <div id="prowlr-scope-rules"></div>
    </div>

    <div class="prowlr-panel hidden" id="prowlr-findings">
      <div class="prowlr-findings-actions">
        <button id="prowlr-export-btn">Export to Obsidian</button>
        <button id="prowlr-refresh-findings">Refresh</button>
      </div>
      <div id="prowlr-findings-list"></div>
      <pre id="prowlr-export-output" class="hidden"></pre>
    </div>

    <div class="prowlr-panel hidden" id="prowlr-terminal">
      <div class="prowlr-terminal-toolbar">
        <div class="prowlr-quick-commands" id="prowlr-quick-cmds"></div>
        <div class="prowlr-terminal-input-row">
          <span class="prowlr-prompt">$</span>
          <input type="text" id="prowlr-terminal-cmd" placeholder="Enter command..." maxlength="4096" />
          <button id="prowlr-terminal-run">Run</button>
          <button id="prowlr-terminal-kill" class="prowlr-btn-danger">Kill</button>
          <button id="prowlr-terminal-clear" class="prowlr-btn-secondary">Clear</button>
        </div>
      </div>
      <div id="prowlr-xterm" class="prowlr-xterm-container"></div>
    </div>

    <div class="prowlr-panel hidden" id="prowlr-settings">
      <h3>General</h3>
      <div class="prowlr-setting">
        <label>Scope Enforcement</label>
        <select id="prowlr-setting-enforcement">
          <option value="warn">Warn (highlight out-of-scope)</option>
          <option value="off">Off</option>
        </select>
      </div>

      <h3>AI Provider</h3>
      <div class="prowlr-setting">
        <label>Provider</label>
        <select id="prowlr-setting-provider">
          <option value="ollama">Ollama (local)</option>
          <option value="claude">Claude (Anthropic API)</option>
        </select>
      </div>

      <div id="prowlr-ollama-settings">
        <div class="prowlr-setting">
          <label>Ollama Endpoint</label>
          <input type="text" id="prowlr-setting-ollama-endpoint" placeholder="http://localhost:11434" />
        </div>
        <div class="prowlr-setting">
          <label>Ollama Model</label>
          <select id="prowlr-setting-ollama-model">
            <option value="llama3.1">llama3.1</option>
          </select>
          <button id="prowlr-refresh-models" class="prowlr-btn-small">Refresh Models</button>
        </div>
      </div>

      <div id="prowlr-claude-settings" class="hidden">
        <div class="prowlr-setting">
          <label>API Key</label>
          <input type="password" id="prowlr-setting-claude-key" placeholder="sk-ant-api03-..." />
        </div>
        <div class="prowlr-setting">
          <label>Model</label>
          <input type="text" id="prowlr-setting-claude-model" value="claude-sonnet-4-20250514" placeholder="claude-sonnet-4-20250514" />
          <small class="prowlr-hint">Any valid model ID — e.g. claude-sonnet-4-20250514, claude-opus-4-20250514</small>
        </div>
        <div class="prowlr-setting">
          <label>Endpoint</label>
          <input type="text" id="prowlr-setting-claude-endpoint" placeholder="https://api.anthropic.com/v1/messages" />
        </div>
        <div class="prowlr-setting">
          <label>Max Tokens</label>
          <input type="number" id="prowlr-setting-claude-max-tokens" value="2048" min="1" max="32000" />
        </div>
        <div class="prowlr-setting">
          <label>API Version</label>
          <input type="text" id="prowlr-setting-claude-api-version" value="2023-06-01" placeholder="2023-06-01" />
        </div>
      </div>

      <h3>Export</h3>
      <div class="prowlr-setting">
        <label>Export Path</label>
        <input type="text" id="prowlr-setting-export-path" placeholder="/home/hunter/exports/findings" />
        <small class="prowlr-hint">Where findings .md files are written</small>
      </div>

      <h3>Terminal</h3>
      <div class="prowlr-setting">
        <label>Timeout (seconds)</label>
        <input type="number" id="prowlr-setting-terminal-timeout" value="300" min="10" max="3600" />
      </div>
      <div class="prowlr-setting">
        <label>Working Directory</label>
        <input type="text" id="prowlr-setting-terminal-cwd" placeholder="(uses $HOME)" />
      </div>

      <h3>AI Prompt</h3>
      <div class="prowlr-setting">
        <label>Analysis Prompt</label>
        <textarea id="prowlr-setting-ai-prompt" rows="6" placeholder="Leave empty for default. Use {REQUEST} and {RESPONSE} placeholders."></textarea>
        <small class="prowlr-hint">Custom prompt for AI analysis. Leave empty for built-in default.</small>
      </div>

      <div class="prowlr-settings-actions">
        <button id="prowlr-settings-save">Save Settings</button>
        <button id="prowlr-test-connection" class="prowlr-btn-secondary">Test Connection</button>
      </div>
      <div id="prowlr-connection-status"></div>
    </div>
  `;

  // Tab switching
  container.querySelectorAll(".prowlr-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".prowlr-tab").forEach((t) => t.classList.remove("active"));
      container.querySelectorAll(".prowlr-panel").forEach((p) => p.classList.add("hidden"));
      tab.classList.add("active");
      const target = (tab as HTMLElement).dataset.tab;
      container.querySelector(`#prowlr-${target}`)?.classList.remove("hidden");
    });
  });

  // Scope: add rule
  container.querySelector("#prowlr-scope-add")?.addEventListener("click", async () => {
    const pattern = (container.querySelector("#prowlr-scope-pattern") as HTMLInputElement).value.trim();
    const type = (container.querySelector("#prowlr-scope-type") as HTMLSelectElement).value as "include" | "exclude";
    if (!pattern) return;
    try {
      await sdk.backend.addScopeRule(pattern, type);
      (container.querySelector("#prowlr-scope-pattern") as HTMLInputElement).value = "";
      await refreshScopeRules(sdk, container);
    } catch (err) {
      sdk.window.showToast(`Failed: ${err}`, { variant: "error" });
    }
  });

  // Findings: export
  container.querySelector("#prowlr-export-btn")?.addEventListener("click", async () => {
    const result = await sdk.backend.exportFindingsToObsidian();
    const output = container.querySelector("#prowlr-export-output") as HTMLPreElement;
    output.textContent = result;
    output.classList.remove("hidden");
    if (result.startsWith("Exported")) {
      sdk.window.showToast(result.split("\n")[0], { variant: "success" });
    } else {
      sdk.window.showToast("Export issue — see output", { variant: "warning" });
    }
  });

  // Findings: refresh
  container.querySelector("#prowlr-refresh-findings")?.addEventListener("click", () => {
    refreshFindings(sdk, container);
  });

  // Settings: provider toggle
  container.querySelector("#prowlr-setting-provider")?.addEventListener("change", (e) => {
    const provider = (e.target as HTMLSelectElement).value;
    const ollamaSection = container.querySelector("#prowlr-ollama-settings") as HTMLElement;
    const claudeSection = container.querySelector("#prowlr-claude-settings") as HTMLElement;
    if (provider === "ollama") {
      ollamaSection.classList.remove("hidden");
      claudeSection.classList.add("hidden");
    } else {
      ollamaSection.classList.add("hidden");
      claudeSection.classList.remove("hidden");
    }
  });

  // Settings: refresh Ollama models
  container.querySelector("#prowlr-refresh-models")?.addEventListener("click", async () => {
    const models = await sdk.backend.getOllamaModels();
    const select = container.querySelector("#prowlr-setting-ollama-model") as HTMLSelectElement;
    const current = select.value;
    select.innerHTML = models.length
      ? models.map((m) => `<option value="${esc(m)}" ${m === current ? "selected" : ""}>${esc(m)}</option>`).join("")
      : '<option value="">No models found — run: ollama pull llama3.1</option>';
    sdk.window.showToast(`Found ${models.length} model(s)`, { variant: models.length ? "success" : "warning" });
  });

  // Settings: test connection
  container.querySelector("#prowlr-test-connection")?.addEventListener("click", async () => {
    const statusEl = container.querySelector("#prowlr-connection-status") as HTMLElement;
    statusEl.textContent = "Testing...";
    statusEl.className = "prowlr-status-testing";
    await saveSettings(sdk, container);
    const result = await sdk.backend.testAIConnection();
    const ok = result.includes("OK");
    statusEl.textContent = result;
    statusEl.className = ok ? "prowlr-status-ok" : "prowlr-status-error";
  });

  // Settings: save
  container.querySelector("#prowlr-settings-save")?.addEventListener("click", async () => {
    try {
      await saveSettings(sdk, container);
      sdk.window.showToast("Settings saved", { variant: "success" });
    } catch (err) {
      sdk.window.showToast(`Save failed: ${err}`, { variant: "error" });
    }
  });

  // ── Terminal setup ──────────────────────────────────────────
  const termSessionId = `prowlr-${Date.now()}`;
  let term: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;

  function initTerminal() {
    const xtermEl = container.querySelector("#prowlr-xterm") as HTMLElement;
    if (!xtermEl || term) return;

    term = new Terminal({
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#00ff88",
        selectionBackground: "#44475a",
        black: "#1a1a2e",
        red: "#ff5555",
        green: "#50fa7b",
        yellow: "#f1fa8c",
        blue: "#6272a4",
        magenta: "#ff79c6",
        cyan: "#8be9fd",
        white: "#e0e0e0",
      },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(xtermEl);
    fitAddon.fit();

    term.writeln("\x1b[36m╔══════════════════════════════════════════╗\x1b[0m");
    term.writeln("\x1b[36m║\x1b[0m  \x1b[1;32mProwlr Terminal\x1b[0m                         \x1b[36m║\x1b[0m");
    term.writeln("\x1b[36m║\x1b[0m  Run hunting tools without leaving Caido  \x1b[36m║\x1b[0m");
    term.writeln("\x1b[36m╚══════════════════════════════════════════╝\x1b[0m");
    term.writeln("");

    resizeObserver = new ResizeObserver(() => {
      if (fitAddon) fitAddon.fit();
    });
    resizeObserver.observe(xtermEl);
  }

  // Lazy-init terminal when tab is clicked
  container.querySelector('[data-tab="terminal"]')?.addEventListener("click", () => {
    setTimeout(() => {
      initTerminal();
      if (fitAddon) fitAddon.fit();
    }, 50);
  });

  // Listen for terminal output events from backend
  sdk.backend.onEvent("terminal:output", (sessionId: string, data: string) => {
    if (sessionId === termSessionId && term) {
      term.write(data);
    }
  });

  sdk.backend.onEvent("terminal:exit", (sessionId: string, code: number) => {
    if (sessionId === termSessionId && term) {
      term.writeln(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m`);
    }
  });

  // Terminal: run command
  const runCmd = async () => {
    const input = container.querySelector("#prowlr-terminal-cmd") as HTMLInputElement;
    const cmd = input.value.trim();
    if (!cmd) return;
    if (term) {
      term.writeln(`\x1b[32m$ ${cmd}\x1b[0m`);
    }
    input.value = "";
    await sdk.backend.terminalExec(termSessionId, cmd);
  };

  container.querySelector("#prowlr-terminal-run")?.addEventListener("click", runCmd);
  container.querySelector("#prowlr-terminal-cmd")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") runCmd();
  });

  // Terminal: kill
  container.querySelector("#prowlr-terminal-kill")?.addEventListener("click", async () => {
    await sdk.backend.terminalKill(termSessionId);
    if (term) term.writeln("\r\n\x1b[31m[killed]\x1b[0m");
  });

  // Terminal: clear
  container.querySelector("#prowlr-terminal-clear")?.addEventListener("click", () => {
    if (term) term.clear();
  });

  // Quick commands
  sdk.backend.getQuickCommands().then((quickCmds) => {
    const cmdContainer = container.querySelector("#prowlr-quick-cmds");
    if (cmdContainer && quickCmds.length) {
      cmdContainer.innerHTML = quickCmds.map((qc) =>
        `<button class="prowlr-quick-cmd" data-cmd="${esc(qc.cmd)}" title="${esc(qc.cmd)}">
          <i class="${esc(qc.icon)}"></i> ${esc(qc.label)}
        </button>`
      ).join("");

      cmdContainer.querySelectorAll(".prowlr-quick-cmd").forEach((btn) => {
        btn.addEventListener("click", () => {
          const cmd = (btn as HTMLElement).dataset.cmd || "";
          const input = container.querySelector("#prowlr-terminal-cmd") as HTMLInputElement;
          input.value = cmd;
          input.focus();
        });
      });
    }
  }).catch(() => {});

  // Initial load
  refreshScopeRules(sdk, container);
  refreshFindings(sdk, container);
  loadSettings(sdk, container);

  return container;
}

// ── Data Refresh ────────────────────────────────────────────

async function refreshScopeRules(sdk: ProwlrSDK, container: HTMLElement) {
  const rules = await sdk.backend.getScopeRules();
  const list = container.querySelector("#prowlr-scope-rules")!;

  if (rules.length === 0) {
    list.innerHTML = '<p class="prowlr-empty">No scope rules. Add patterns to enforce scope.</p>';
    return;
  }

  // Build DOM safely — no innerHTML with user data
  list.innerHTML = "";
  for (const rule of rules) {
    const div = document.createElement("div");
    div.className = `prowlr-rule ${rule.type} ${rule.active ? "" : "inactive"}`;

    const typeSpan = document.createElement("span");
    typeSpan.className = "prowlr-rule-type";
    typeSpan.textContent = rule.type.toUpperCase();

    const patternSpan = document.createElement("span");
    patternSpan.className = "prowlr-rule-pattern";
    patternSpan.textContent = rule.pattern;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "prowlr-rule-toggle";
    toggleBtn.textContent = rule.active ? "Disable" : "Enable";
    toggleBtn.addEventListener("click", async () => {
      await sdk.backend.toggleScopeRule(rule.id);
      await refreshScopeRules(sdk, container);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "prowlr-rule-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      await sdk.backend.removeScopeRule(rule.id);
      await refreshScopeRules(sdk, container);
    });

    div.append(typeSpan, patternSpan, toggleBtn, deleteBtn);
    list.appendChild(div);
  }
}

async function refreshFindings(sdk: ProwlrSDK, container: HTMLElement) {
  const findings = await sdk.backend.getFindings();
  const list = container.querySelector("#prowlr-findings-list")!;

  if (findings.length === 0) {
    list.innerHTML = '<p class="prowlr-empty">No findings yet. Right-click a request → Analyze with Prowlr.</p>';
    return;
  }

  // Build DOM safely — no innerHTML with AI/user data
  list.innerHTML = "";
  for (const f of findings) {
    const div = document.createElement("div");
    div.className = `prowlr-finding severity-${f.severity}`;

    const header = document.createElement("div");
    header.className = "prowlr-finding-header";

    const sevSpan = document.createElement("span");
    sevSpan.className = "prowlr-severity";
    sevSpan.textContent = f.severity.toUpperCase();

    const titleSpan = document.createElement("span");
    titleSpan.className = "prowlr-finding-title";
    titleSpan.textContent = f.title;

    header.append(sevSpan, titleSpan);

    if (f.exported) {
      const exportedSpan = document.createElement("span");
      exportedSpan.className = "prowlr-exported";
      exportedSpan.textContent = "exported";
      header.appendChild(exportedSpan);
    }

    const meta = document.createElement("div");
    meta.className = "prowlr-finding-meta";
    const code = document.createElement("code");
    code.textContent = `${f.method} ${f.url}`;
    const dateSpan = document.createElement("span");
    dateSpan.textContent = f.timestamp.split("T")[0];
    meta.append(code, dateSpan);

    const body = document.createElement("div");
    body.className = "prowlr-finding-body";
    body.textContent = f.description;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "prowlr-finding-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      await sdk.backend.deleteFinding(f.id);
      await refreshFindings(sdk, container);
    });

    div.append(header, meta, body, deleteBtn);
    list.appendChild(div);
  }
}

async function saveSettings(sdk: ProwlrSDK, container: HTMLElement) {
  const enforcement = (container.querySelector("#prowlr-setting-enforcement") as HTMLSelectElement).value;
  const provider = (container.querySelector("#prowlr-setting-provider") as HTMLSelectElement).value;
  const ollamaEndpoint = (container.querySelector("#prowlr-setting-ollama-endpoint") as HTMLInputElement).value;
  const ollamaModel = (container.querySelector("#prowlr-setting-ollama-model") as HTMLSelectElement).value;
  const claudeKey = (container.querySelector("#prowlr-setting-claude-key") as HTMLInputElement).value;
  const claudeModel = (container.querySelector("#prowlr-setting-claude-model") as HTMLInputElement).value;
  const claudeEndpoint = (container.querySelector("#prowlr-setting-claude-endpoint") as HTMLInputElement).value;
  const claudeMaxTokens = (container.querySelector("#prowlr-setting-claude-max-tokens") as HTMLInputElement).value;
  const claudeApiVersion = (container.querySelector("#prowlr-setting-claude-api-version") as HTMLInputElement).value;
  const exportPath = (container.querySelector("#prowlr-setting-export-path") as HTMLInputElement).value;
  const terminalTimeout = (container.querySelector("#prowlr-setting-terminal-timeout") as HTMLInputElement).value;
  const terminalCwd = (container.querySelector("#prowlr-setting-terminal-cwd") as HTMLInputElement).value;
  const aiPrompt = (container.querySelector("#prowlr-setting-ai-prompt") as HTMLTextAreaElement).value;

  // Always save all fields — empty string clears the setting
  await Promise.all([
    sdk.backend.setSetting("scope_enforcement", enforcement),
    sdk.backend.setSetting("ai_provider", provider),
    sdk.backend.setSetting("ollama_endpoint", ollamaEndpoint),
    sdk.backend.setSetting("ollama_model", ollamaModel),
    sdk.backend.setSetting("claude_api_key", claudeKey),
    sdk.backend.setSetting("claude_model", claudeModel),
    sdk.backend.setSetting("claude_endpoint", claudeEndpoint),
    sdk.backend.setSetting("claude_max_tokens", claudeMaxTokens || "2048"),
    sdk.backend.setSetting("claude_api_version", claudeApiVersion || "2023-06-01"),
    sdk.backend.setSetting("export_path", exportPath),
    sdk.backend.setSetting("terminal_timeout", terminalTimeout || "300"),
    sdk.backend.setSetting("terminal_cwd", terminalCwd),
    sdk.backend.setSetting("ai_analysis_prompt", aiPrompt),
  ]);
}

async function loadSettings(sdk: ProwlrSDK, container: HTMLElement) {
  const [enforcement, provider, ollamaEndpoint, ollamaModel, claudeModel,
         claudeEndpoint, claudeMaxTokens, claudeApiVersion, exportPath,
         terminalTimeout, terminalCwd, aiPrompt] = await Promise.all([
    sdk.backend.getSetting("scope_enforcement"),
    sdk.backend.getSetting("ai_provider"),
    sdk.backend.getSetting("ollama_endpoint"),
    sdk.backend.getSetting("ollama_model"),
    sdk.backend.getSetting("claude_model"),
    sdk.backend.getSetting("claude_endpoint"),
    sdk.backend.getSetting("claude_max_tokens"),
    sdk.backend.getSetting("claude_api_version"),
    sdk.backend.getSetting("export_path"),
    sdk.backend.getSetting("terminal_timeout"),
    sdk.backend.getSetting("terminal_cwd"),
    sdk.backend.getSetting("ai_analysis_prompt"),
  ]);

  (container.querySelector("#prowlr-setting-enforcement") as HTMLSelectElement).value = enforcement || "warn";

  const providerSelect = container.querySelector("#prowlr-setting-provider") as HTMLSelectElement;
  providerSelect.value = provider || "ollama";
  providerSelect.dispatchEvent(new Event("change"));

  (container.querySelector("#prowlr-setting-ollama-endpoint") as HTMLInputElement).value = ollamaEndpoint || "http://localhost:11434";
  (container.querySelector("#prowlr-setting-claude-model") as HTMLInputElement).value = claudeModel || "claude-sonnet-4-20250514";

  if (claudeEndpoint) {
    (container.querySelector("#prowlr-setting-claude-endpoint") as HTMLInputElement).value = claudeEndpoint;
  }

  (container.querySelector("#prowlr-setting-claude-max-tokens") as HTMLInputElement).value = claudeMaxTokens || "2048";
  (container.querySelector("#prowlr-setting-claude-api-version") as HTMLInputElement).value = claudeApiVersion || "2023-06-01";
  (container.querySelector("#prowlr-setting-export-path") as HTMLInputElement).value = exportPath || "/home/hunter/exports/findings";
  (container.querySelector("#prowlr-setting-terminal-timeout") as HTMLInputElement).value = terminalTimeout || "300";
  (container.querySelector("#prowlr-setting-terminal-cwd") as HTMLInputElement).value = terminalCwd || "";
  (container.querySelector("#prowlr-setting-ai-prompt") as HTMLTextAreaElement).value = aiPrompt || "";

  // Load Ollama models if that's the active provider
  if (!provider || provider === "ollama") {
    const models = await sdk.backend.getOllamaModels();
    const select = container.querySelector("#prowlr-setting-ollama-model") as HTMLSelectElement;
    if (models.length) {
      select.innerHTML = models.map((m) =>
        `<option value="${esc(m)}" ${m === (ollamaModel || "llama3.1") ? "selected" : ""}>${esc(m)}</option>`
      ).join("");
    }
  }
}

// ── Context Menu Handlers ───────────────────────────────────

async function handleAnalyze(sdk: ProwlrSDK, context: any) {
  const requests = context.requests || (context.request ? [context.request] : []);
  if (requests.length === 0) {
    sdk.window.showToast("No request selected", { variant: "warning" });
    return;
  }

  sdk.window.showToast("Analyzing with AI...", { variant: "info" });

  for (const req of requests) {
    const requestId = typeof req === "string" ? req : req.getId?.() || req.id;
    const analysis = await sdk.backend.analyzeRequest(requestId);
    await sdk.backend.saveAnalysisAsFinding(requestId, analysis);
    sdk.window.showToast(
      `${analysis.severity.toUpperCase()}: ${analysis.summary}`,
      { variant: analysis.severity === "info" ? "info" : "warning" }
    );
  }
}

async function handleScopeCheck(sdk: ProwlrSDK, context: any) {
  const requests = context.requests || (context.request ? [context.request] : []);
  if (requests.length === 0) return;

  for (const req of requests) {
    // Extract URL from the request object
    const url = typeof req === "string"
      ? req
      : req.getUrl?.() || req.url || "https://unknown";
    const result = await sdk.backend.checkScope(url);
    sdk.window.showToast(
      result.inScope ? "In scope" : `OUT OF SCOPE${result.matchedRule ? ` (${result.matchedRule})` : ""}`,
      { variant: result.inScope ? "success" : "warning" }
    );
  }
}

// ── Init ────────────────────────────────────────────────────

export const init = (sdk: ProwlrSDK) => {
  // Register commands
  sdk.commands.register(Commands.analyzeRequest, {
    name: "Analyze with Prowlr",
    run: (context) => handleAnalyze(sdk, context),
  });

  sdk.commands.register(Commands.checkScope, {
    name: "Check Scope",
    run: (context) => handleScopeCheck(sdk, context),
  });

  sdk.commands.register(Commands.exportFindings, {
    name: "Export Findings to Obsidian",
    run: async () => {
      const result = await sdk.backend.exportFindingsToObsidian();
      if (result.startsWith("No new")) {
        sdk.window.showToast(result, { variant: "info" });
      } else {
        sdk.window.showToast("Findings exported", { variant: "success" });
      }
    },
  });

  // Context menus (right-click on requests)
  sdk.menu.registerItem({
    type: "RequestRow",
    commandId: Commands.analyzeRequest,
    leadingIcon: "fas fa-brain",
  });

  sdk.menu.registerItem({
    type: "RequestRow",
    commandId: Commands.checkScope,
    leadingIcon: "fas fa-crosshairs",
  });

  sdk.menu.registerItem({
    type: "Request",
    commandId: Commands.analyzeRequest,
    leadingIcon: "fas fa-brain",
  });

  // Command palette
  sdk.commandPalette.register(Commands.analyzeRequest);
  sdk.commandPalette.register(Commands.exportFindings);

  // Sidebar page
  const page = buildPage(sdk);
  sdk.navigation.addPage(Page, { body: page });
  sdk.sidebar.registerItem("Prowlr", Page, { icon: "fas fa-crosshairs" });
};
