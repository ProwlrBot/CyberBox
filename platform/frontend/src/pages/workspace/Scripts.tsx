import { useState } from "react";
import { Code2, Copy, CheckCheck, ExternalLink } from "lucide-react";

type Skill = {
  id: string;
  name: string;
  description: string;
};

type Script = {
  filename: string;
  description: string;
  path: string;
};

type Oneliner = {
  label: string;
  cmd: string;
};

const SKILLS: Skill[] = [
  { id: "cve-hunt",           name: "cve-hunt",           description: "CVE-to-exploit hypothesis builder" },
  { id: "vuln-targets",       name: "vuln-targets",       description: "Spin up vulnerable targets for lab testing" },
  { id: "raptor-template",    name: "raptor-template-gen",description: "Generate Raptor scan templates for new protocols" },
  { id: "nuclei-template",    name: "nuclei-template-gen",description: "AI-powered Nuclei template generation" },
  { id: "report-writing",     name: "report-writing",     description: "Structured bug report writer with impact analysis" },
  { id: "source-audit",       name: "source-audit",       description: "Deep source code audit workflow" },
  { id: "web2-recon",         name: "web2-recon",         description: "Web application recon pipeline" },
  { id: "oauth-hunter",       name: "oauth-hunter",       description: "OAuth2 attack surface analysis" },
  { id: "graphql-audit",      name: "graphql-audit",      description: "GraphQL introspection + attack surface" },
  { id: "jwt-scan",           name: "jwt-scan",           description: "JWT attack surface scanner" },
];

const SCRIPTS: Script[] = [
  {
    filename: "install-malware-tools.sh",
    description: "Install offensive security tools into sandbox",
    path: "cybersandbox/scripts/install-malware-tools.sh",
  },
  {
    filename: "seed-wordlists.sh",
    description: "Download and seed wordlists (SecLists, etc.)",
    path: "cybersandbox/scripts/seed-wordlists.sh",
  },
];

const ONELINERS: Oneliner[] = [
  {
    label: "Subdomain enum",
    cmd: "subfinder -d TARGET -silent | httpx -silent | tee hosts.txt",
  },
  {
    label: "Nuclei scan",
    cmd: "nuclei -l hosts.txt -severity critical,high -o findings.txt",
  },
  {
    label: "Secret scan",
    cmd: "trufflehog git https://github.com/ORG/REPO --json | tee secrets.jsonl",
  },
  {
    label: "JS endpoints",
    cmd: "katana -u TARGET -js-crawl -silent | grep api",
  },
  {
    label: "SQL injection",
    cmd: 'ghauri -u "TARGET?id=1" --dbs --batch',
  },
];

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // fallback: not available
    }
  }

  return (
    <button
      className="action-btn"
      onClick={copy}
      style={{ fontSize: 11, padding: "3px 10px", display: "flex", alignItems: "center", gap: 4 }}
      title="Copy to clipboard"
    >
      {copied ? <CheckCheck size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function Scripts() {
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="page-targets">
      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: "var(--panel-2)", border: "1px solid var(--accent)",
          color: "var(--accent)", padding: "10px 16px", borderRadius: 6,
          fontFamily: "JetBrains Mono, monospace", fontSize: 12,
        }}>
          {toast}
        </div>
      )}

      <div className="page-toolbar">
        <div className="page-title">
          <Code2 size={16} />
          <span>Scripts</span>
          <small>{SKILLS.length} skills · {SCRIPTS.length} scripts</small>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

        {/* Prowl Skills */}
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--muted)",
          marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
        }}>
          Prowl Skills
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12, marginBottom: 36,
        }}>
          {SKILLS.map((skill) => (
            <div key={skill.id} style={{
              background: "var(--panel)", border: "1px solid var(--border)",
              borderRadius: 6, padding: "14px 16px",
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <code style={{
                  fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                  color: "var(--accent)", fontWeight: 700, wordBreak: "break-all",
                }}>
                  /{skill.name}
                </code>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, lineHeight: 1.55, flex: 1 }}>
                {skill.description}
              </p>
              <button
                className="action-btn"
                style={{ fontSize: 11, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 4 }}
                onClick={() => showToast(`Skill docs: /${skill.name}`)}
              >
                <ExternalLink size={11} />
                Open docs
              </button>
            </div>
          ))}
        </div>

        {/* Available Scripts */}
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--muted)",
          marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
          borderTop: "1px solid var(--border)", paddingTop: 24,
        }}>
          Available Scripts
        </div>
        <div className="data-table-wrap" style={{ marginBottom: 36 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Description</th>
                <th>Command</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {SCRIPTS.map((script) => (
                <tr key={script.filename} className="data-row">
                  <td>
                    <code className="mono-cell" style={{ color: "var(--accent)", fontWeight: 600 }}>
                      {script.filename}
                    </code>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{script.description}</td>
                  <td>
                    <code className="mono-cell" style={{ fontSize: 11 }}>
                      sh {script.path}
                    </code>
                  </td>
                  <td>
                    <CopyBtn text={`sh ${script.path}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Quick Oneliners */}
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--muted)",
          marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em",
          borderTop: "1px solid var(--border)", paddingTop: 24,
        }}>
          Quick Oneliners
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ONELINERS.map((line) => (
            <div key={line.label} style={{
              background: "var(--panel)", border: "1px solid var(--border)",
              borderRadius: 6, overflow: "hidden",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 14px",
                borderBottom: "1px solid var(--border)",
                background: "var(--panel-2)",
              }}>
                <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {line.label}
                </span>
                <CopyBtn text={line.cmd} />
              </div>
              <div style={{ padding: "12px 14px" }}>
                <code style={{
                  fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                  color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>
                  {line.cmd}
                </code>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
