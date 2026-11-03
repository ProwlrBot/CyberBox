# CyberBox Implementation Plan

## Phase 1 — Audit and reliability

Exit gates:

- Architecture, audit, threat model, security baseline, design system, and SDK contracts reviewed.
- One health registry reports Ready/Running/Degraded/Unavailable/Missing dependency/Requires configuration/Preview/Stub/Experimental.
- Browser, terminal, Jupyter, Plugin Center, code-server, MCP, database, and storage probes tested.
- Compose modes reconciled; loopback is default; `seccomp:unconfined` removed or explicitly gated.
- Dashboard end-to-end smoke suite runs in CI.
- Existing workspace migration and browser-session recovery tested.

## Phase 2 — Workspace foundation (in progress)

- [x] Promote the hardened control API into Docker Compose behind the main origin.
- [x] Implement the complete profile catalog and project templates.
- [x] Add targets/exclusions/rates/authorization/policy acknowledgments.
- [x] Make ScopeGuard deny by default for control-plane scans, research experiments, and playbook-triggered executions.
- Complete evidence, finding, timeline, tool-lockfile, and project export models.
- [x] Issue short-lived capability tokens to panels/providers.
- [x] Gate Plugin Center evidence, registry sync, service logs, and restart with explicit capability permissions.
- [x] Live-verify the Plugin Center preview labels and service-log recovery after rebuilding both images.
- [x] Reduce repetitive runtime noise in service recovery logs so actionable lines stay visible.
- [x] Expose an explicit runtime summary so the frontend distinguishes the control plane from the isolated workspace shell instead of presenting a single fake monolith.

## Phase 3 — Investigation core

- Runtime broker and Containers panel.
- Live shell route/status inventory for Browser, Terminal, Jupyter, code-server, and Plugin Center.
- Job engine with logs, cancellation, leases, recovery, resources, and artifacts.
- Tool catalog/provider health/version inventory.
- mitmproxy provider, traffic storage, replay/diff, browser correlation.
- Targets/recon inventory and change tracking.
- Health center and actionable recovery.

## Phase 4 — Automation

- Versioned workflow schema and validator.
- Typed nodes, permissions, ScopeGuard requirements, budgets, cleanup.
- Dry run, approvals, pause/resume/cancel/retry, breakpoints.
- Visual builder after engine/state-machine tests are stable.

## Phase 5 — Domain profiles

Domain profile records now exist for Web, API, Mobile, Cloud, Containers/Kubernetes, Malware, Forensics, OSINT, SOC, CTF, Security Education, Custom, and the legacy Red/Blue/Purple compatibility views. They remain Preview unless capability probes, isolated runtime policy, fixtures, documentation, and an end-to-end test prove the profile is operational.

## Phase 6 — Ecosystem

- Signed plugin packages, quarantine, permissions, compatibility, revocation.
- Provider, Workflow, Plugin, and MCP SDK conformance suites.
- WASM runtime for portable extensions; isolated subprocess provider for native tools.

## Phase 7 — Product completion

- Maintained application shell and docking engine.
- Accessibility and keyboard navigation.
- Performance budgets and virtualization.
- Packaging, migrations, backup/restore, release provenance.
- Multi-user roles and isolation tests.

## Definition of done

A feature is complete only when its capability probe is honest, trust boundaries are documented, unit/integration tests pass, the Docker runtime is exercised, errors are actionable, and user-visible behavior is manually or automatically verified.
