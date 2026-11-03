# CyberBox Threat Model

## Protected assets

Project scope, targets, credentials, browser sessions, source code, evidence, malware samples, cloud/device tokens, reports, plugin trust metadata, host resources, and other users' workspaces.

## Primary adversaries

- Malicious target content rendered by Chromium or parsed by tools.
- Malicious uploaded file/archive/notebook/sample.
- Compromised or deceptive plugin, MCP server, package, image, template, or extension.
- Command/prompt injection through traffic, logs, documentation, or AI context.
- Curious or malicious authenticated user crossing project/team boundaries.
- Compromised workspace process attempting host/control-plane access.

## Trust boundaries

1. Host ↔ control plane.
2. Control plane ↔ runtime broker.
3. Runtime broker ↔ project workspace.
4. Browser UI ↔ privileged APIs.
5. Panel iframe ↔ application shell.
6. Plugin/MCP/provider ↔ project data and secrets.
7. Internet/target ↔ proxy/browser/tools.
8. Original evidence ↔ derived/redacted artifacts.

## Highest-risk abuse paths

- Docker socket or runtime-broker misuse leading to host control.
- Same-origin panel compromise calling privileged APIs.
- CSBX install hook escaping intended directories or exfiltrating secrets.
- Browser target exploit reaching persistent project data.
- Notebook or malware sample executing with unrestricted network/host mounts.
- Scope bypass via DNS rebinding, redirects, IDN normalization, or stale scope decisions.
- Secret leakage into terminal history, notebook output, logs, exports, or AI prompts.
- Archive traversal/symlink swap/zip bomb during import.
- Cross-user IDOR in project/evidence/job APIs.

## Required controls

- Rootless workers where supported; dropped capabilities; seccomp; AppArmor/SELinux; read-only root; PID/CPU/memory/disk quotas.
- Dedicated malware/forensics policies with no host mounts and restricted egress.
- Short-lived, audience-bound capability tokens for panels and provider calls.
- Central ScopeGuard with normalized targets, DNS/IP checks, redirect re-evaluation, budgets, and immutable scope-version references.
- Structured subprocess arguments; no shell concatenation.
- Signed plugin metadata, hash verification, quarantine, permission review, enable step, revocation.
- Content-addressed evidence, chain of custody, immutable originals, redacted derivatives.
- Secret IDs rather than values; redaction at logs/UI/export/AI boundaries.
- CSRF/origin/WebSocket authentication and iframe sandboxing.
- Append-only audit events with correlation IDs.

## Security invariants

1. Unknown scope is denied.
2. A workspace never receives the Docker socket.
3. Plugins start disabled and permissionless.
4. Downloaded content is never executed automatically.
5. AI output creates leads, never confirmed findings.
6. Original evidence is immutable.
7. Secret values never appear in persisted workflow definitions.
8. Cross-project access is denied even when object IDs are known.
