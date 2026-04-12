# Security Policy

## Reporting a Vulnerability

If you find a security issue in CyberSandbox (especially in install hooks, entrypoint scripts, or Docker configuration), report it privately:

- Email: prowlr@proton.me
- Subject: `[CyberSandbox Security] <brief description>`

Do NOT open a public issue for security vulnerabilities.

## Scope

- Docker image build process and entrypoint scripts
- Plugin manager (csbx) install hooks and registry validation
- MCP configuration merging
- Volume mount permissions and container escape vectors

## Out of Scope

- Upstream AIO Sandbox vulnerabilities (report to [agent-infra/sandbox](https://github.com/agent-infra/sandbox))
- Vulnerabilities in bundled third-party tools (nuclei, nmap, etc.) — report to their maintainers
- Intentional offensive tool behavior (this is a security research platform)

## Response

- Acknowledgment within 48 hours
- Fix or mitigation within 7 days for critical issues
- Credit in CHANGELOG unless you prefer anonymity
