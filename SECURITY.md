# Security Policy

Report suspected vulnerabilities privately to **prowlr@proton.me** with subject `[CyberBox Security] <brief description>`. Do not open a public issue.

Full policy (scope, disclosure window, hardening notes): [`cybersandbox/SECURITY.md`](cybersandbox/SECURITY.md).

## Product security baseline

CyberBox treats target content, uploaded files, browser sessions, terminals, notebooks, plugins, MCP servers, providers, and tool output as untrusted. The target architecture and current gaps are documented in [THREAT_MODEL.md](THREAT_MODEL.md) and [AUDIT.md](AUDIT.md).

Security invariants:

- Unknown or stale scope is denied for active providers.
- Workspace users never receive direct Docker-socket access.
- Downloaded plugins are quarantined and permissionless until verified and enabled.
- Original evidence is immutable and content-addressed.
- Secrets are referenced by ID and redacted at output boundaries.
- Local internal service tokens are generated outside git, scoped to Compose, and must never be exposed to browser JavaScript.
- Provider actions use short-lived capability tokens with exact permissions instead of broad API keys.
- Sensitive Plugin Center operations, including service log access and restart, require explicit short-lived capabilities.
- AI-generated observations cannot directly become confirmed findings.
- Cross-project and cross-user isolation is enforced server-side.

The current development Compose configuration does not yet meet the complete target baseline. In particular, elevated network capabilities, writable root filesystem, root entry, and single-workspace persistence remain tracked Phase 1/2 risks and must not be represented as production multi-user isolation.
