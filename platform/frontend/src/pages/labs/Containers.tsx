import { useState } from "react";
import { Container, RefreshCw, X as XIcon, Copy, Check } from "lucide-react";
import { getApiKey } from "../../lib/api";

interface ContainerSettings {
  dockerHost: string;
}

const DEFAULTS: ContainerSettings = { dockerHost: "unix:///var/run/docker.sock" };

function loadSettings<T>(key: string, defaults: T): T {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; }
  catch { return defaults; }
}
function saveSettings<T>(key: string, s: T) { localStorage.setItem(key, JSON.stringify(s)); }

type TargetImage = {
  id: string;
  image: string;
  name: string;
  description: string;
  port: number;
  dockerCmd: string;
};

const TARGETS: TargetImage[] = [
  {
    id: "dvwa",
    image: "dvwa",
    name: "DVWA",
    description: "Damn Vulnerable Web App — SQL injection, XSS, file inclusion, command injection",
    port: 8080,
    dockerCmd: "docker run -d -p 8080:80 --name dvwa dvwa",
  },
  {
    id: "webgoat",
    image: "webgoat/webgoat",
    name: "WebGoat",
    description: "OWASP WebGoat — structured security training lessons",
    port: 8080,
    dockerCmd: "docker run -d -p 8080:8080 --name webgoat webgoat/webgoat",
  },
  {
    id: "dvwa-latest",
    image: "ghcr.io/digininja/dvwa",
    name: "DVWA (latest)",
    description: "DVWA latest from digininja — actively maintained fork",
    port: 80,
    dockerCmd: "docker run -d -p 80:80 --name dvwa-latest ghcr.io/digininja/dvwa",
  },
  {
    id: "wordpress",
    image: "wordpress:latest + mysql:5.7",
    name: "WordPress + MySQL",
    description: "Full WordPress stack for plugin CVE testing and WP-specific attack chains",
    port: 8081,
    dockerCmd: `docker network create wp-net
docker run -d --name wp-mysql --network wp-net \\
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=wordpress \\
  -e MYSQL_USER=wp -e MYSQL_PASSWORD=wp mysql:5.7
docker run -d --name wordpress --network wp-net \\
  -p 8081:80 \\
  -e WORDPRESS_DB_HOST=wp-mysql \\
  -e WORDPRESS_DB_USER=wp \\
  -e WORDPRESS_DB_PASSWORD=wp \\
  -e WORDPRESS_DB_NAME=wordpress wordpress:latest`,
  },
  {
    id: "gitlab",
    image: "gitlab/gitlab-ee",
    name: "Local GitLab EE",
    description: "GitLab Enterprise Edition — CI/CD token theft, SSRF, deploy key abuse",
    port: 8929,
    dockerCmd: `docker run --detach \\
  --hostname gitlab.local \\
  --publish 8929:80 --publish 8922:22 \\
  --name gitlab --restart always \\
  gitlab/gitlab-ee:latest`,
  },
  {
    id: "verdaccio",
    image: "verdaccio/verdaccio",
    name: "Verdaccio NPM Registry",
    description: "Private NPM registry — dependency confusion, package takeover testing",
    port: 4873,
    dockerCmd: "docker run -d -p 4873:4873 --name verdaccio verdaccio/verdaccio",
  },
  {
    id: "metabase",
    image: "metabase/metabase",
    name: "Metabase",
    description: "BI dashboard — multiple CVEs including pre-auth RCE (CVE-2023-38646)",
    port: 3000,
    dockerCmd: "docker run -d -p 3000:3000 --name metabase metabase/metabase",
  },
  {
    id: "mariadb",
    image: "ghcr.io/williamdes/mariadb-mysql-slim",
    name: "MariaDB / MySQL Slim",
    description: "Bare database for SQL injection labs and blind SQLi practice",
    port: 3306,
    dockerCmd: `docker run -d -p 3306:3306 \\
  -e MYSQL_ROOT_PASSWORD=toor \\
  -e MYSQL_DATABASE=lab \\
  --name mariadb-lab \\
  ghcr.io/williamdes/mariadb-mysql-slim`,
  },
];

export default function Containers() {
  const [settings, setSettings] = useState<ContainerSettings>(() => loadSettings("cbx.lab.containers", DEFAULTS));
  const [modal, setModal] = useState<TargetImage | null>(null);
  const [copied, setCopied] = useState(false);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function updateSetting<K extends keyof ContainerSettings>(k: K, v: ContainerSettings[K]) {
    const next = { ...settings, [k]: v };
    setSettings(next);
    saveSettings("cbx.lab.containers", next);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function checkServer() {
    setChecking(true);
    setServerOk(null);
    const key = getApiKey();
    const headers: Record<string, string> = key ? { "X-Api-Key": key } : {};
    try {
      const r = await fetch("/api/v1/health", { headers });
      setServerOk(r.ok);
    } catch {
      setServerOk(false);
    } finally {
      setChecking(false);
    }
  }

  function copyCmd(cmd: string) {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => showToast("Copy failed — select the text manually"));
  }

  return (
    <div className="page-targets">
      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: "var(--panel-2)", border: "1px solid var(--accent)",
          color: "var(--accent)", padding: "10px 18px", borderRadius: 6,
          fontFamily: "monospace", fontSize: 13,
        }}>
          {toast}
        </div>
      )}

      <div className="page-toolbar">
        <div className="page-title">
          <Container size={16} />
          <span>Containers</span>
        </div>
      </div>

      {/* Settings */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Settings</h2>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Docker Host</span>
            <input
              style={{ padding: "7px 10px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontFamily: "monospace", fontSize: 13, maxWidth: 480 }}
              value={settings.dockerHost}
              onChange={(e) => updateSetting("dockerHost", e.target.value)}
              placeholder="unix:///var/run/docker.sock"
            />
          </label>
        </div>
      </section>

      {/* Quick Launch */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Quick Launch — Vuln Targets</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {TARGETS.map((t) => (
            <div key={t.id} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                <span style={{ fontSize: 11, color: "var(--muted)", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px" }}>:{t.port}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, flex: 1 }}>{t.description}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{t.image}</div>
              <button className="action-btn primary" onClick={() => { setModal(t); setCopied(false); }} style={{ alignSelf: "flex-start" }}>
                Launch
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Running Containers */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ color: "var(--muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", margin: 0 }}>Running Containers</h2>
          <button className="action-btn" onClick={checkServer} disabled={checking}>
            <RefreshCw size={13} /> {checking ? "Checking…" : "Refresh"}
          </button>
        </div>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 24 }}>
          {serverOk === true && (
            <div style={{ marginBottom: 12, fontSize: 12, color: "var(--good)" }}>CyberBox server reachable</div>
          )}
          {serverOk === false && (
            <div style={{ marginBottom: 12, fontSize: 12, color: "var(--bad)" }}>Server unreachable</div>
          )}
          <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
            Connect to Docker socket to list running containers.
          </p>
          <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
            Configure Docker API access via{" "}
            <a href="https://docs.docker.com/engine/api/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)" }}>
              Docker Engine API docs
            </a>
            {" "}or expose the socket through a local proxy.
          </p>
        </div>
      </section>

      {/* Modal */}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div className="modal" style={{ maxWidth: 640, width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{modal.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{modal.image}</div>
              </div>
              <button className="action-btn" onClick={() => setModal(null)}>
                <XIcon size={14} />
              </button>
            </div>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>{modal.description}</p>
            <pre style={{
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
              padding: 16, margin: "0 0 14px", fontSize: 12, fontFamily: "monospace",
              color: "var(--text)", overflowX: "auto", lineHeight: 1.7, whiteSpace: "pre",
            }}>
              {modal.dockerCmd}
            </pre>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="action-btn primary" onClick={() => copyCmd(modal.dockerCmd)}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied!" : "Copy command"}
              </button>
              <button className="action-btn" onClick={() => setModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
