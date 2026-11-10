import { useEffect, useState } from "react";
import { GitBranch, ExternalLink, Play, RefreshCw } from "lucide-react";
import { getApiKey } from "../../lib/api";

interface GitLabSettings {
  gitlabUrl: string;
  adminToken: string;
  projectId: string;
}

const DEFAULTS: GitLabSettings = {
  gitlabUrl: "http://localhost:8929",
  adminToken: "",
  projectId: "",
};

function loadSettings<T>(key: string, defaults: T): T {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; }
  catch { return defaults; }
}
function saveSettings<T>(key: string, s: T) { localStorage.setItem(key, JSON.stringify(s)); }

const DOCKER_CMD = `docker run --detach \\
  --hostname gitlab.local \\
  --publish 8929:80 --publish 8922:22 \\
  --name gitlab \\
  --restart always \\
  gitlab/gitlab-ee:latest`;

const PLAYBOOK = [
  "Register CI runner with --registration-token (enumerate from /admin/runners)",
  "Create fork, modify .gitlab-ci.yml to exfil CI_JOB_TOKEN",
  "Test merge request triggers and protected branches",
  "Check /api/v4/projects?membership=false (unauthenticated project listing)",
  "Check deploy tokens: GET /api/v4/projects/{id}/deploy_tokens",
  "SSRF via webhooks: POST /api/v4/projects/{id}/hooks",
];

export default function GitLab() {
  const [settings, setSettings] = useState<GitLabSettings>(() => loadSettings("cbx.lab.gitlab", DEFAULTS));
  const [cbxProjectId, setCbxProjectId] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
    fetch("/api/v1/projects", { headers })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { const pid: string = data[0]?.id ?? ""; setCbxProjectId(pid); })
      .catch(() => {});
  }, []);

  function updateSetting<K extends keyof GitLabSettings>(k: K, v: GitLabSettings[K]) {
    const next = { ...settings, [k]: v };
    setSettings(next);
    saveSettings("cbx.lab.gitlab", next);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function importFindings() {
    if (!cbxProjectId) { showToast("No CyberBox project found"); return; }
    setImporting(true);
    const key = getApiKey();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    };
    try {
      const r = await fetch(`/api/v1/projects/${cbxProjectId}/gori/import`, {
        method: "POST",
        headers,
        body: JSON.stringify({ source: "gitlab", url: settings.gitlabUrl }),
      });
      if (r.ok) {
        const data = await r.json();
        showToast(`Imported ${data.count ?? "?"} findings`);
      } else {
        showToast(`Import failed: ${r.status}`);
      }
    } catch (e) {
      showToast("Import error — check network");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="page-targets">
      {toast && (
        <div
          style={{
            position: "fixed", top: 16, right: 16, zIndex: 9999,
            background: "var(--panel-2)", border: "1px solid var(--accent)",
            color: "var(--accent)", padding: "10px 18px", borderRadius: 6,
            fontFamily: "monospace", fontSize: 13,
          }}
        >
          {toast}
        </div>
      )}

      <div className="page-toolbar">
        <div className="page-title">
          <GitBranch size={16} />
          <span>GitLab Lab</span>
        </div>
      </div>

      {/* Settings */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Settings</h2>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 20, display: "grid", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>GitLab Instance URL</span>
            <input
              className="filter-input-wrap"
              style={{ padding: "7px 10px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontFamily: "monospace", fontSize: 13 }}
              value={settings.gitlabUrl}
              onChange={(e) => updateSetting("gitlabUrl", e.target.value)}
              placeholder="http://localhost:8929"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Admin Token (PAT)</span>
            <input
              className="filter-input-wrap"
              style={{ padding: "7px 10px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontFamily: "monospace", fontSize: 13 }}
              type="password"
              value={settings.adminToken}
              onChange={(e) => updateSetting("adminToken", e.target.value)}
              placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Target Project (namespace/path)</span>
            <input
              className="filter-input-wrap"
              style={{ padding: "7px 10px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontFamily: "monospace", fontSize: 13 }}
              value={settings.projectId}
              onChange={(e) => updateSetting("projectId", e.target.value)}
              placeholder="group/project-name"
            />
          </label>
        </div>
      </section>

      {/* Quick Actions */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Quick Actions</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 18 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Import Findings</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>Pull GitLab issues into CyberBox via Gori</div>
            <button className="action-btn primary" onClick={importFindings} disabled={importing}>
              <Play size={13} /> {importing ? "Importing…" : "Import findings"}
            </button>
          </div>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 18 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Scan with Raptor</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>Run Raptor GitLab CI/CD source scan</div>
            <a className="action-btn" href="/source/gitlab" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
              <ExternalLink size={13} /> Open Raptor
            </a>
          </div>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 18 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>View Executions</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>Monitor running and past scan jobs</div>
            <a className="action-btn" href="/system/activity" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
              <ExternalLink size={13} /> Activity
            </a>
          </div>
        </div>
      </section>

      {/* Docker Setup */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Docker Setup</h2>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
            Spin up a local GitLab EE instance for testing. First-run setup takes ~5 minutes.
          </p>
          <pre style={{
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
            padding: 16, margin: 0, fontSize: 12, fontFamily: "monospace",
            color: "var(--text)", overflowX: "auto", lineHeight: 1.7,
          }}>
            {DOCKER_CMD}
          </pre>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
            After boot: <code style={{ color: "var(--accent)" }}>docker exec gitlab grep 'Password:' /etc/gitlab/initial_root_password</code>
          </p>
        </div>
      </section>

      {/* Attack Playbook */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Attack Playbook — GitLab CI/CD</h2>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
          <ol style={{ margin: 0, padding: "0 0 0 20px", display: "grid", gap: 12 }}>
            {PLAYBOOK.map((step, i) => (
              <li key={i} style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
                <code style={{ color: "var(--accent)", fontFamily: "monospace", fontSize: 12 }}>{step}</code>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
