(function () {
  const root = document.getElementById("app");
  const modes = [
    ["fresh-drop", "Fresh drop", "Favor recent source activity."],
    ["quiet-gold", "Quiet gold", "Favor established programs with less noise."],
    ["beginner-entry", "Beginner entry", "Favor simpler setup and a clear first surface."],
    ["deep-dive", "Deep dive", "Favor programs with a broader research surface."],
    ["wordpress-whitebox", "WordPress", "Favor WordPress and source-review targets."],
    ["api-hunter", "API hunter", "Favor API and authorization surfaces."],
    ["government-cvd", "Government / CVD", "Favor verified public-sector sources."],
    ["surprise-me", "Balanced", "Use the stored score without a mode-specific boost."],
  ];
  const state = {
    tab: "programs", items: [], detail: null, drawn: null, health: {},
    query: "", scopeState: "", mode: "surprise-me", error: "",
  };

  async function request(path, options) {
    const response = await fetch(path, { cache: "no-store", ...options });
    const type = response.headers.get("content-type") || "";
    const payload = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(typeof payload === "string" ? payload : payload.error || `Request failed (${response.status})`);
    return payload;
  }

  async function load() {
    try {
      state.health = await request("/api/health");
      await loadPrograms();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function loadPrograms() {
    const params = new URLSearchParams({ limit: "200" });
    if (state.query) params.set("q", state.query);
    if (state.scopeState) params.set("scope_state", state.scopeState);
    const result = await request(`/api/v1/programs?${params}`);
    state.items = result.items || [];
    if (!state.detail || !state.items.some((item) => item.id === state.detail.id)) {
      state.detail = state.items[0] ? await request(`/api/v1/programs/${encodeURIComponent(state.items[0].id)}`) : null;
    }
    state.error = "";
    render();
  }

  async function selectProgram(id) {
    try {
      state.detail = await request(`/api/v1/programs/${encodeURIComponent(id)}`);
      state.error = "";
    } catch (error) {
      state.error = error.message;
    }
    render();
  }

  async function drawTarget() {
    try {
      state.drawn = await request("/api/v1/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: state.mode, limit: 1, exclude_ids: [] }),
      });
      state.detail = await request(`/api/v1/programs/${encodeURIComponent(state.drawn.program.id)}`);
      state.error = "";
    } catch (error) {
      state.error = error.message;
    }
    render();
  }

  function render() {
    root.innerHTML = `<div class="shell">
      <aside class="nav">
        <div class="brand"><div><strong>ScopeDeck</strong><small>Program and scope research</small></div></div>
        <div class="nav-list">
          <button data-tab="programs" class="${state.tab === "programs" ? "active" : ""}">Programs</button>
          <button data-tab="draw" class="${state.tab === "draw" ? "active" : ""}">Draw a target</button>
        </div>
        <div class="nav-bottom">Local data. Source labels stay attached.</div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="meta">
            <strong class="mobile-brand">ScopeDeck</strong>
            <span class="pill">${escapeHTML(state.health.state || "preview")}</span>
            <span class="pill">${Number(state.health.programs || 0)} programs</span>
            <span class="pill">${Number(state.health.sources || 0)} sources</span>
          </div>
        </header>
        ${state.error ? `<div class="error" role="alert">${escapeHTML(state.error)}</div>` : ""}
        ${state.tab === "programs" ? programsView() : drawView()}
      </main>
    </div>`;
    bindEvents();
  }

  function programsView() {
    const rows = state.items.map((program) => `<tr data-program="${escapeHTML(program.id)}" class="${state.detail?.id === program.id ? "selected" : ""}">
      <td><strong>${escapeHTML(program.name)}</strong><div class="small">${escapeHTML(program.platform_name || "")}</div></td>
      <td>${escapeHTML(program.reward_status || "unknown")}</td>
      <td><span class="score ${scoreClass(program.opportunity_score)}">${Number(program.opportunity_score || 0)}</span></td>
      <td>${Number(program.data_confidence || 0)}</td>
      <td>${escapeHTML(humanize(program.scope_state || "unknown"))}</td>
      <td>${escapeHTML(program.last_source_update || "")}</td>
    </tr>`).join("");
    return `<section class="workspace">
      <article class="panel">
        <div class="section-head"><div><h2>Programs</h2><div class="muted">Search imported records without changing them.</div></div></div>
        <form id="search-form" class="controls search-controls">
          <label><span>Search</span><input id="q" value="${escapeHTML(state.query)}" placeholder="Program or platform"></label>
          <label><span>Scope state</span><select id="scope-state">
            ${scopeOption("", "Any scope state")}
            ${scopeOption("officially_in_scope", "Officially in scope")}
            ${scopeOption("official_vdp", "Official VDP")}
            ${scopeOption("community_attributed", "Community attributed")}
            ${scopeOption("requires_policy_confirmation", "Policy confirmation required")}
            ${scopeOption("unknown", "Unknown")}
          </select></label>
          <button type="submit">Apply</button>
        </form>
        <div class="table-wrap"><table><thead><tr><th>Program</th><th>Reward</th><th>Score</th><th>Confidence</th><th>Scope</th><th>Source update</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="empty">No matching programs.</td></tr>`}</tbody></table></div>
      </article>
      ${detailView(state.detail)}
    </section>`;
  }

  function drawView() {
    const cards = modes.map(([id, label, description]) => `<button class="mode ${state.mode === id ? "active" : ""}" data-mode="${id}"><strong>${escapeHTML(label)}</strong><small>${escapeHTML(description)}</small></button>`).join("");
    return `<section class="draw-workspace">
      <article class="panel draw-panel">
        <div class="section-head"><div><h2>Draw a target</h2><div class="muted">Weighted selection from the records already in this database.</div></div></div>
        <div class="draw-grid">${cards}</div>
        <div class="toolbar"><p class="small">A draw is a research suggestion, not proof of scope or permission.</p><button id="draw">Draw</button></div>
      </article>
      ${state.drawn ? `<article class="panel result"><div class="section-head"><div><h2>${escapeHTML(state.drawn.program.name)}</h2><div class="muted">${escapeHTML((state.drawn.reason || []).filter(Boolean).join(" · ") || "Selected by stored score")}</div></div></div>${detailBody(state.detail)}</article>` : `<article class="panel empty-state"><h2>No draw yet</h2><p>Choose a mode and draw from the imported programs.</p></article>`}
    </section>`;
  }

  function detailView(program) {
    return `<aside class="panel detail"><div class="section-head"><div><h2>${escapeHTML(program?.name || "Program detail")}</h2><div class="muted">${escapeHTML(program?.platform_name || "Select a row")}</div></div></div>${detailBody(program)}</aside>`;
  }

  function detailBody(program) {
    if (!program) return `<div class="empty-state"><p>Import a source or select a program to inspect it.</p></div>`;
    const assets = (program.assets || []).map((asset) => `<div class="list-item"><strong>${escapeHTML(humanize(asset.asset_type || "asset"))}</strong><span>${escapeHTML(asset.value || "")}</span><small>${escapeHTML(humanize(asset.scope_state || "unknown"))} · ${Number(asset.confidence || 0)} confidence</small></div>`).join("");
    const policies = (program.policies || []).map((policy) => {
      const url = safeURL(policy.policy_url);
      return `<div class="list-item"><strong>Policy</strong><span>${escapeHTML(policy.policy_text || "No stored policy text")}</span>${url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</div>`;
    }).join("");
    const sources = (program.sources || []).map((source) => `<span class="tag">${escapeHTML(source.name)} · ${escapeHTML(humanize(source.authority))}</span>`).join("");
    return `<div class="detail-content">
      <div class="detail-grid">
        ${metric("Opportunity", program.opportunity_score, "Stored rank, not likelihood")}
        ${metric("Confidence", program.data_confidence, "Source-data confidence")}
        ${metric("Scope", humanize(program.scope_state || "unknown"), "Confirm against current policy")}
        ${metric("Setup", program.setup_difficulty || "unknown", "Recorded setup estimate")}
      </div>
      <div class="card"><label>Why selected</label><p>${escapeHTML(program.why_selected || program.why_now || "No selection note recorded.")}</p></div>
      <div class="card"><label>First surface</label><p>${escapeHTML(program.best_attack_surface || "Not recorded")}</p></div>
      <div class="card"><label>Scope assets</label><div class="list">${assets || `<p>No scope assets stored.</p>`}</div></div>
      <div class="card"><label>Policy</label><div class="list">${policies || `<p>No policy snapshot stored.</p>`}</div></div>
      <div class="card"><label>Sources</label><div class="tags">${sources || `<span class="muted">No source row available.</span>`}</div></div>
      <div class="footer-actions"><button id="copy-program">Copy program JSON</button><button id="copy-scope">Copy scope JSON</button><span id="copy-status" class="small" aria-live="polite"></span></div>
    </div>`;
  }

  function metric(label, value, note) {
    return `<div class="card"><label>${escapeHTML(label)}</label><strong>${escapeHTML(value)}</strong><p>${escapeHTML(note)}</p></div>`;
  }

  function scopeOption(value, label) {
    return `<option value="${escapeHTML(value)}" ${state.scopeState === value ? "selected" : ""}>${escapeHTML(label)}</option>`;
  }

  function bindEvents() {
    document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { state.tab = button.dataset.tab; render(); }));
    document.querySelectorAll("[data-program]").forEach((row) => row.addEventListener("click", () => selectProgram(row.dataset.program)));
    document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => { state.mode = button.dataset.mode; render(); }));
    document.getElementById("draw")?.addEventListener("click", drawTarget);
    document.getElementById("search-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      state.query = document.getElementById("q").value.trim();
      state.scopeState = document.getElementById("scope-state").value;
      try { await loadPrograms(); } catch (error) { state.error = error.message; render(); }
    });
    document.getElementById("copy-program")?.addEventListener("click", () => copyJSON(state.detail));
    document.getElementById("copy-scope")?.addEventListener("click", () => copyJSON({ program_id: state.detail?.id, program: state.detail?.name, scope_state: state.detail?.scope_state, assets: state.detail?.assets || [] }));
  }

  async function copyJSON(value) {
    const status = document.getElementById("copy-status");
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      if (status) status.textContent = "Copied";
    } catch (_) {
      if (status) status.textContent = "Clipboard unavailable";
    }
  }

  function scoreClass(value) { return value >= 75 ? "good" : value >= 50 ? "mid" : "low"; }
  function humanize(value) { return String(value || "").replaceAll("_", " "); }
  function safeURL(value) {
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch (_) { return ""; }
  }
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  load();
})();
