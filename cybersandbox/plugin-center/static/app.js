let data = { plugins: [], previews: [], profiles: [], health: { components: [] } };
let view = "plugins";
const $ = (selector) => document.querySelector(selector);
const content = $("#content");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
})[character]);

async function load() {
  const [stateResponse, healthResponse] = await Promise.all([
    fetch("api/state", { cache: "no-store" }), fetch("api/health", { cache: "no-store" }),
  ]);
  if (!stateResponse.ok || !healthResponse.ok) throw Error("CyberBox service state unavailable");
  data = { ...await stateResponse.json(), health: await healthResponse.json() };
  $("#available").textContent = data.plugins.length;
  $("#installed").textContent = data.plugins.filter((plugin) => plugin.installed).length;
  $("#previews").textContent = data.previews.length;
  $("#health").textContent = data.health.state;
  populateFilters();
  render();
}

function populateFilters() {
  const type = $("#type");
  const currentType = type.value;
  type.innerHTML = '<option value="">All types</option>' + [...new Set(data.plugins.map((plugin) => plugin.type))]
    .sort().map((name) => `<option>${esc(name)}</option>`).join("");
  type.value = currentType;
  const profile = $("#profile");
  const currentProfile = profile.value;
  profile.innerHTML = '<option value="">All profiles</option>' + data.profiles
    .map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
  profile.value = currentProfile;
}

function render() {
  const query = $("#search").value.toLowerCase();
  const type = $("#type").value;
  const profile = $("#profile").value;
  if (view === "health") {
    content.innerHTML = `<div class="grid">${data.health.components.map(healthCard).join("")}</div>`;
    content.querySelectorAll("[data-service]").forEach((button) => {
      button.onclick = () => showService(button.dataset.service, button.dataset.state);
    });
    return;
  }
  const rows = (view === "plugins" ? data.plugins : data.previews).filter((item) =>
    (!type || item.type === type) &&
    (!profile || (item.profiles || []).includes(profile)) &&
    `${item.name} ${item.description} ${(item.tags || item.controls || []).join(" ")}`.toLowerCase().includes(query));
  content.innerHTML = rows.length
    ? `<div class="grid">${rows.map(view === "plugins" ? pluginCard : previewCard).join("")}</div>`
    : '<p class="empty">No matching integrations for this profile.</p>';
  content.querySelectorAll("[data-command]").forEach((button) => {
    button.onclick = () => button.dataset.plugin
      ? showPlan(button.dataset.plugin, button.dataset.title, button.dataset.command)
      : showCommand(button.dataset.title, button.dataset.command);
  });
}

function healthCard(component) {
  const healthy = component.state === "Ready" || component.state === "Running";
  const recoverable = ["browser", "terminal", "jupyter", "code-server", "mcp"].includes(component.id);
  const service = component.id === "mcp" ? "mcp-hub" : component.id;
  return `<article data-component-id="${esc(component.id)}"><div><span class="type">subsystem</span><span class="state ${healthy ? "yes" : "preview"}">${esc(component.state)}</span></div><h2>${esc(component.name)}</h2><p>${esc(component.cause || "Verified and responding normally.")}</p><footer>${component.usage_percent !== undefined ? `<span class="tag">${component.usage_percent}% used</span>` : ""}${recoverable ? `<button class="action" data-service="${esc(service)}" data-state="${esc(component.state)}">Logs & recovery</button>` : ""}</footer></article>`;
}

function pluginCard(plugin) {
  const command = plugin.installed ? `csbx update ${plugin.name}` : plugin.command;
  const state = plugin.installed ? "installed" : "available";
  const trust = plugin.trust_tier === "strict" ? `${plugin.signature_method || "signature"} required` : plugin.pinned ? "pinned source" : "mutable source";
  return `<article><div><span class="type">${esc(plugin.type)}</span><span class="state ${plugin.installed ? "yes" : plugin.trust_tier === "strict" ? "yes" : ""}">${state}</span></div><h2>${esc(plugin.name)}</h2><p>${esc(plugin.description)}</p><footer><small>${esc(plugin.size)}</small><span class="tag">${esc(trust)}</span>${(plugin.tags || []).slice(0, 1).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}<button class="action" data-plugin="${esc(plugin.name)}" data-title="${esc(plugin.name)}" data-command="${esc(command)}">${plugin.installed ? "Update preview" : "Review install plan"}</button></footer></article>`;
}

function previewCard(preview) {
  const state = preview.available ? "available in image" : esc(preview.maturity);
  const riskLabel = preview.risk ? preview.risk.replace(/^[a-z]/, (match) => match.toUpperCase()).replace("-", " ") : "";
  return `<article><div><span class="type">${esc(preview.kind)}</span><span class="state ${preview.available ? "yes" : "preview"}">${state}</span></div><h2>${esc(preview.name)}</h2><p>${esc(preview.description)}</p><footer>${preview.risk ? `<span class="tag">${esc(riskLabel)}</span>` : ""}${preview.controls.slice(0, 1).map((control) => `<span class="tag">${esc(control)}</span>`).join("")}<button class="action" data-title="${esc(preview.name)} preview" data-command="${esc(preview.command)}">Open preview</button></footer></article>`;
}

function showCommand(title, command) {
  $("#command-title").textContent = title;
  $("#command-value").textContent = command;
  $("#plan-block").hidden = true;
  $("#command").showModal();
}

async function showPlan(name, title, command) {
  $("#command-title").textContent = title;
  $("#command-value").textContent = command;
  $("#plan-value").textContent = "Resolving registry plan…";
  $("#plan-block").hidden = false;
  $("#command").showModal();
  try {
    const response = await fetch(`api/plan?name=${encodeURIComponent(name)}`, { cache: "no-store" });
    const plan = await response.json();
    if (!response.ok) throw Error(plan.error || "Plan unavailable");
    $("#plan-value").textContent = JSON.stringify(plan, null, 2);
    $("#command-value").textContent = plan.command;
  } catch (error) {
    $("#plan-value").textContent = error.message;
  }
}

async function copyCommand() {
  await navigator.clipboard.writeText($("#command-value").textContent);
}

let selectedService = "";
async function showService(service, serviceState) {
  selectedService = service;
  $("#service-title").textContent = service;
  $("#service-state").textContent = `Current state: ${serviceState} · logs require service.read capability.`;
  $("#service-lines").textContent = "Loading logs…";
  $("#service-log").showModal();
  const response = await fetch(`api/services/${encodeURIComponent(service)}/logs`, {
    headers: { "X-CyberBox-Action": "view-service-logs" },
  });
  const result = await response.json();
  $("#service-state").textContent = result.ok
    ? `Current state: ${serviceState} · logs require ${result.required_permission || "service.read"} capability.`
    : result.error;
  const summary = result.ok && result.noise_summary ? `${result.noise_summary}\n\n` : "";
  $("#service-lines").textContent = result.ok ? `${summary}${result.lines.join("\n") || "No log entries."}` : result.error;
}

document.querySelectorAll("nav>button").forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll("nav>button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    view = button.dataset.view;
    $("#type").hidden = view !== "plugins";
    $("#profile").hidden = view === "health";
    $("#search").closest("label").hidden = view === "health";
    render();
  };
});
$("#search").oninput = render;
$("#type").onchange = render;
$("#profile").onchange = render;
$("#copy").onclick = async () => {
  await copyCommand();
  $("#copy").textContent = "Copied";
  setTimeout(() => { $("#copy").textContent = "Copy preview"; }, 1200);
};
$("#terminal").onclick = async () => {
  await copyCommand();
  try { parent.document.querySelector("button[data-panel=terminal]")?.click(); } catch {}
  $("#command").close();
};
$("#restart-service").onclick = async () => {
  const button = $("#restart-service");
  button.disabled = true;
  button.textContent = "Restarting…";
  try {
    const response = await fetch(`api/services/${encodeURIComponent(selectedService)}/restart`, {
      method: "POST", headers: { "X-CyberBox-Action": "restart-service" },
    });
    const result = await response.json();
    $("#service-state").textContent = result.ok
      ? `Restart requested successfully${result.capability_id ? ` via capability ${result.capability_id}` : ""}${result.required_permission ? ` (${result.required_permission})` : ""}.`
      : result.error || "Restart failed.";
    if (result.ok) await load();
  } finally {
    button.disabled = false;
    button.textContent = "Restart service";
  }
};
$("#sync").onclick = async () => {
  const button = $("#sync");
  button.disabled = true;
  button.textContent = "Syncing…";
  try {
    const response = await fetch("api/sync", { method: "POST", headers: { "X-CSBX-Action": "sync-registry" } });
    if (!response.ok) throw Error("Sync failed");
    await load();
  } finally {
    button.disabled = false;
    button.textContent = "Sync registry";
  }
};
$("#evidence-open").onclick = () => {
  $("#evidence-status").textContent = "Writes use a short-lived provider token with evidence.write.";
  $("#evidence-dialog").showModal();
};
$("#evidence-submit").onclick = async () => {
  const button = $("#evidence-submit");
  button.disabled = true;
  button.textContent = "Capturing…";
  $("#evidence-status").textContent = "Requesting scoped provider token…";
  try {
    const response = await fetch("api/evidence/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CyberBox-Action": "capture-evidence" },
      body: JSON.stringify({
        project_id: $("#evidence-project").value.trim(),
        title: $("#evidence-title").value.trim() || "Plugin Center evidence",
        content: $("#evidence-content").value.trim(),
        metadata: { panel: "plugin-center", view },
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error || "Evidence capture failed");
    $("#evidence-status").textContent = `Captured artifact ${result.artifact.id}`;
  } catch (error) {
    $("#evidence-status").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Capture evidence";
  }
};
load().catch((error) => { content.innerHTML = `<p class="empty">${esc(error.message)}</p>`; });
