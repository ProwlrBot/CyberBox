# CyberBox Architecture

## Target shape

```text
Browser
  └─ CyberBox Shell (same-origin UI, capability-scoped sessions)
      ├─ Code / Browser / Terminal / Jupyter panels
      ├─ Traffic / Targets / Jobs / Evidence / Findings / Workflows
      └─ Plugin / MCP / Runtime / Health panels
                     │
              CyberBox Control API
      ┌──────────────┼────────────────┐
      │ Project Context │ ScopeGuard  │ Audit/Timeline
      │ Job Engine      │ Evidence    │ Findings
      │ Workflow Engine │ Secrets IDs │ Health Registry
      └──────────────┬────────────────┘
                     │ typed provider calls
      ┌──────────────┼──────────────────────────┐
      │ Runtime Provider │ Tool Provider │ Proxy Provider
      │ Browser Provider │ Notebook      │ Cloud/Mobile/etc.
      └──────────────┴──────────────────────────┘
                     │
          workspace-isolated containers/workers
```

## Control plane

`platform/backend` now runs as an internal Compose sidecar at `/control/` on the main origin; its separate frontend is not a second product shell. It owns projects, authorization, scope, targets, profiles, project templates, jobs, workflows, evidence, findings, timeline, provider health, and capability grants. SQLite remains valid for local single-user mode; PostgreSQL becomes the multi-user option.

The control plane never exposes the Docker socket to workspace users. A runtime broker owns narrowly scoped lifecycle operations.

## Data plane

Each project receives an isolated workspace runtime with a project volume, scratch volume, secrets mount, resource policy, and network policy. Tool execution occurs as structured provider jobs. Browser, terminal, notebook, and proxy sessions carry project and user IDs.

## Context envelope

Every cross-panel operation carries:

```json
{
  "project_id": "uuid",
  "workspace_id": "uuid",
  "user_id": "uuid",
  "target_id": "uuid-or-null",
  "scope_version": 4,
  "correlation_id": "uuid",
  "capability_token": "short-lived-reference"
}
```

## Persistence

- Relational database: metadata, state machines, policies, audit events.
- Content-addressed artifact store: evidence, reports, captures, imports.
- Project volume: editable workspace files.
- Secrets provider: secret values; database stores references only.
- Append-only activity stream: correlated actions and state changes.

## Workspace Profiles And Templates

The control plane seeds sixteen built-in profiles: Bug Bounty, Web Application Testing, API Security, Mobile Security, Cloud Security, Container and Kubernetes Security, Malware Analysis, Digital Forensics, OSINT, SOC and Incident Response, CTF, Security Education, Custom, plus legacy Red Team, Blue Team, and Purple Team compatibility profiles.

Each profile carries default panels, recommended tools, workflow playbooks, runtime policy, authorization posture, and safety gates. Profiles with high containment needs, such as Malware Analysis and Digital Forensics, default to offline/restricted runtime settings and manual approval.

Project templates are separate from profiles. They create reproducible starting policy for common engagements, including bug bounty, web/API testing, Android/iOS assessment, cloud/Kubernetes review, malware reverse engineering, disk forensics, phishing investigation, OSINT, CTF, and education labs. Template-created engagements start as authorization-pending with no approved scope rules; active execution still requires explicit target/scope data.

## ScopeGuard Foundation

Targets are stored as project inventory in `project_targets`; scope authorization remains engagement-specific through `scope_rules_v2` plus `scope_acknowledgments`.

The current control-plane decision path is:

1. Engagement status must be `authorized`, `local-laboratory`, `ctf`, or legacy `active`.
2. Non-legacy authorized states require a matching latest acknowledgment.
3. Expired acknowledgments fail closed.
4. URL scheme, host, port, method, include rules, exclude rules, and action risk are evaluated centrally in `services/policy.py`.
5. Allowed decisions return the matched rule, normalized host, port, rate limit, and concurrency limit for downstream providers.

Control-plane scans, research experiments, and playbook-triggered executions use this policy path. Terminal, browser, Jupyter, and third-party panel enforcement still need capability-token integration before they can be claimed as fully ScopeGuard-enforced.

## Capability Tokens

The control plane now issues short-lived `cbcap_` tokens for panels, providers, plugins, MCP servers, and workflows. Only SHA-256 token digests are stored. Each token is bound to a project, optional engagement, subject type, subject ID, permission list, status, TTL, and metadata.

Capability verification is exact-match and fail-closed:

- expired tokens are denied;
- revoked tokens are denied;
- project or engagement mismatches are denied;
- missing permissions are denied;
- successful verification updates `last_used_at`.

The first provider-only path is `POST /api/v1/provider/projects/{project_id}/artifacts`, which requires `evidence.write` through `X-CyberBox-Capability`. User API keys can still use the normal authenticated artifact endpoint. Browser, terminal, Jupyter, Plugin Center, and MCP must be moved to provider routes incrementally before broad panel isolation can be claimed.

Plugin Center now uses this path for explicit evidence-note capture. `./bin/cyberbox` generates a local internal service token at `.cyberbox/internal-service.token` and passes it only through Compose environment. Plugin Center uses that internal token only to request short-lived provider capabilities. Evidence capture requests `evidence.write` and writes through the provider-only artifact route. Service log viewing requests `service.read`; service restart requests `service.restart`; registry sync requests and verifies `plugin.registry.sync` before running `csbx sync` locally in the sandbox. The admin API key is not mounted into the sandbox container.

## Deployment modes

- Local single user: Compose, loopback binding, SQLite, one control plane, isolated project workers.
- Self-hosted multi-user: reverse proxy/OIDC, PostgreSQL, object store, worker pool.
- Restricted/offline: vendored images/packs, deny-egress policy, local registries.
- Kubernetes: control API plus namespace-isolated workers; planned after runtime-provider contract stabilizes.

## Migration

1. Keep current panels operational.
2. Embed the hardened control API into Compose. **Completed for local Compose.**
3. Replace generated-dashboard patching with a maintained shell package.
4. Add context adapters to Terminal, Browser, Jupyter, Plugin Center, and Caido.
5. Move execution behind ScopeGuard/jobs.
6. Split project runtimes only after export/migration exists.
