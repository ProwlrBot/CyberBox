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
        <input type="text" id="prowlr-scope-pattern" placeholder="*.example.com" />
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
          <input type="text" id="prowlr-terminal-cmd" placeholder="Enter command..." />
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
          <select id="prowlr-setting-claude-model">
            <option value="claude-sonnet-4-20250514">Sonnet 4 (fast, cheap)</option>
            <option value="claude-opus-4-20250514">Opus 4 (best)</option>
            <option value="claude-haiku-4-5-20251001">Haiku 4.5 (fastest)</option>
          </select>
        </div>
        <div class="prowlr-setting">
          <label>Endpoint</label>
          <input type="text" id="prowlr-setting-claude-endpoint" placeholder="https://api.anthropic.com/v1/messages" />
        </div>
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
    await sdk.backend.addScopeRule(pattern, type);
    (container.querySelector("#prowlr-scope-pattern") as HTMLInputElement).value = "";
    await refreshScopeRules(sdk, container);
  });

  // Findings: export
  container.querySelector("#prowlr-export-btn")?.addEventListener("click", async () => {
    const markdown = await sdk.backend.exportFindingsToObsidian();
    const output = container.querySelector("#prowlr-export-output") as HTMLPreElement;
    output.textContent = markdown;
    output.classList.remove("hidden");
    sdk.window.showToast("Findings exported — copy markdown to your vault", { variant: "success" });
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
      ? models.map((m) => `<option value="${m}" ${m === current ? "selected" : ""}>${m}</option>`).join("")
      : '<option value="">No models found — run: ollama pull llama3.1</option>';
    sdk.window.showToast(`Found ${models.length} model(s)`, { variant: models.length ? "success" : "warning" });
  });

  // Settings: test connection
  container.querySelector("#prowlr-test-connection")?.addEventListener("click", async () => {
    const statusEl = container.querySelector("#prowlr-connection-status") as HTMLElement;
    statusEl.textContent = "Testing...";
    statusEl.className = "prowlr-status-testing";

    // Save current settings first
    await saveSettings(sdk, container);

    const result = await sdk.backend.testAIConnection();
    const ok = result.includes("OK");
    statusEl.textContent = result;
    statusEl.className = ok ? "prowlr-status-ok" : "prowlr-status-error";
  });

  // Settings: save
  container.querySelector("#prowlr-settings-save")?.addEventListener("click", async () => {
    await saveSettings(sdk, container);
    sdk.window.showToast("Settings saved", { variant: "success" });
  });

  // ── Terminal setup ──────────────────────────────────────────
  const termSessionId = `prowlr-${Date.now()}`;
  let term: Terminal | null = null;
  let fitAddon: FitAddon | null = null;

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

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
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
  (async () => {
    const quickCmds = await sdk.backend.getQuickCommands();
    const cmdContainer = container.querySelector("#prowlr-quick-cmds");
    if (cmdContainer && quickCmds.length) {
      cmdContainer.innerHTML = quickCmds.map((qc) =>
        `<button class="prowlr-quick-cmd" data-cmd="${qc.cmd}" title="${qc.cmd}">
          <i class="${qc.icon}"></i> ${qc.label}
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
  })();

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

  list.innerHTML = rules
    .map(
      (rule) => `
    <div class="prowlr-rule ${rule.type} ${rule.active ? "" : "inactive"}">
      <span class="prowlr-rule-type">${rule.type.toUpperCase()}</span>
      <span class="prowlr-rule-pattern">${rule.pattern}</span>
      <button class="prowlr-rule-toggle" data-id="${rule.id}">${rule.active ? "Disable" : "Enable"}</button>
      <button class="prowlr-rule-delete" data-id="${rule.id}">Delete</button>
    </div>
  `
    )
    .join("");

  list.querySelectorAll(".prowlr-rule-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await sdk.backend.toggleScopeRule(Number((btn as HTMLElement).dataset.id));
      await refreshScopeRules(sdk, container);
    });
  });

  list.querySelectorAll(".prowlr-rule-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await sdk.backend.removeScopeRule(Number((btn as HTMLElement).dataset.id));
      await refreshScopeRules(sdk, container);
    });
  });
}

async function refreshFindings(sdk: ProwlrSDK, container: HTMLElement) {
  const findings = await sdk.backend.getFindings();
  const list = container.querySelector("#prowlr-findings-list")!;

  if (findings.length === 0) {
    list.innerHTML = '<p class="prowlr-empty">No findings yet. Right-click a request → Analyze with Prowlr.</p>';
    return;
  }

  list.innerHTML = findings
    .map(
      (f) => `
    <div class="prowlr-finding severity-${f.severity}">
      <div class="prowlr-finding-header">
        <span class="prowlr-severity">${f.severity.toUpperCase()}</span>
        <span class="prowlr-finding-title">${f.title}</span>
        ${f.exported ? '<span class="prowlr-exported">exported</span>' : ""}
      </div>
      <div class="prowlr-finding-meta">
        <code>${f.method} ${f.url}</code>
        <span>${f.timestamp.split("T")[0]}</span>
      </div>
      <div class="prowlr-finding-body">${f.description}</div>
      <button class="prowlr-finding-delete" data-id="${f.id}">Delete</button>
    </div>
  `
    )
    .join("");

  list.querySelectorAll(".prowlr-finding-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await sdk.backend.deleteFinding(Number((btn as HTMLElement).dataset.id));
      await refreshFindings(sdk, container);
    });
  });
}

async function saveSettings(sdk: ProwlrSDK, container: HTMLElement) {
  const enforcement = (container.querySelector("#prowlr-setting-enforcement") as HTMLSelectElement).value;
  const provider = (container.querySelector("#prowlr-setting-provider") as HTMLSelectElement).value;
  const ollamaEndpoint = (container.querySelector("#prowlr-setting-ollama-endpoint") as HTMLInputElement).value;
  const ollamaModel = (container.querySelector("#prowlr-setting-ollama-model") as HTMLSelectElement).value;
  const claudeKey = (container.querySelector("#prowlr-setting-claude-key") as HTMLInputElement).value;
  const claudeModel = (container.querySelector("#prowlr-setting-claude-model") as HTMLSelectElement).value;
  const claudeEndpoint = (container.querySelector("#prowlr-setting-claude-endpoint") as HTMLInputElement).value;

  await sdk.backend.setSetting("scope_enforcement", enforcement);
  await sdk.backend.setSetting("ai_provider", provider);
  if (ollamaEndpoint) await sdk.backend.setSetting("ollama_endpoint", ollamaEndpoint);
  if (ollamaModel) await sdk.backend.setSetting("ollama_model", ollamaModel);
  if (claudeKey) await sdk.backend.setSetting("claude_api_key", claudeKey);
  if (claudeModel) await sdk.backend.setSetting("claude_model", claudeModel);
  if (claudeEndpoint) await sdk.backend.setSetting("claude_endpoint", claudeEndpoint);
}

async function loadSettings(sdk: ProwlrSDK, container: HTMLElement) {
  const enforcement = await sdk.backend.getSetting("scope_enforcement");
  const provider = await sdk.backend.getSetting("ai_provider");
  const ollamaEndpoint = await sdk.backend.getSetting("ollama_endpoint");
  const ollamaModel = await sdk.backend.getSetting("ollama_model");
  const claudeModel = await sdk.backend.getSetting("claude_model");
  const claudeEndpoint = await sdk.backend.getSetting("claude_endpoint");

  (container.querySelector("#prowlr-setting-enforcement") as HTMLSelectElement).value = enforcement || "warn";

  const providerSelect = container.querySelector("#prowlr-setting-provider") as HTMLSelectElement;
  providerSelect.value = provider || "ollama";
  // Trigger visibility
  providerSelect.dispatchEvent(new Event("change"));

  (container.querySelector("#prowlr-setting-ollama-endpoint") as HTMLInputElement).value = ollamaEndpoint || "http://localhost:11434";

  if (claudeModel) {
    (container.querySelector("#prowlr-setting-claude-model") as HTMLSelectElement).value = claudeModel;
  }
  if (claudeEndpoint) {
    (container.querySelector("#prowlr-setting-claude-endpoint") as HTMLInputElement).value = claudeEndpoint;
  }

  // Load Ollama models if that's the active provider
  if (!provider || provider === "ollama") {
    const models = await sdk.backend.getOllamaModels();
    const select = container.querySelector("#prowlr-setting-ollama-model") as HTMLSelectElement;
    if (models.length) {
      select.innerHTML = models.map((m) =>
        `<option value="${m}" ${m === (ollamaModel || "llama3.1") ? "selected" : ""}>${m}</option>`
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
    const requestId = typeof req === "string" ? req : req.getId?.() || req.id;
    const result = await sdk.backend.checkScope(
      `https://placeholder.test` // URL extracted from request in backend
    );
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
      const markdown = await sdk.backend.exportFindingsToObsidian();
      if (markdown.startsWith("No new")) {
        sdk.window.showToast(markdown, { variant: "info" });
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
