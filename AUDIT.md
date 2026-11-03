# CyberBox Product Audit

Audit date: 2026-07-12

## Executive finding

CyberBox is currently a collection of capable but weakly coordinated surfaces. The Docker workstation is the real user-facing product; `platform/` is an unfinished control-plane prototype; the Caido plugin maintains separate scope, findings, settings, and terminal state; CSBX is primarily a shell plugin manager; and the generated SDKs describe the upstream sandbox API rather than a unified CyberBox investigation model.

No current component is the authoritative owner of project, target, scope, job, evidence, finding, workflow, or health state across the product.

## Repository inventory

| Surface | Stack | Current owner | State |
|---|---|---|---|
| Docker workstation | upstream AIO runtime, Nginx, Supervisor, code-server, Chromium/VNC, terminal, Jupyter | `cybersandbox/` overlay | Running, fragmented |
| Main dashboard | generated `/opt/aio/index.html`, runtime patched | upstream image + entrypoint patch | Degraded maintainability |
| Plugin Center | Python HTTP sidecar + static JS/CSS | `cybersandbox/plugin-center/` | Preview |
| Prowlr | Caido TypeScript plugin | `caido-plugin/` | Functional, isolated state |
| prowl/csbx/invoke CLIs | Bash plus partial Go migration | `prowl/`, `cli/` | Mixed/partial |
| Control-plane prototype | FastAPI, SQLite, React/Vite | `platform/` | Development prototype |
| Sandbox SDKs | generated Python/JS/Go | `sdk/` | Upstream API clients |
| Docs site | Rspress | `website/` | Functional, product drift |

## Runtime topology

- Root Compose pulls `ghcr.io/prowlrbot/cybersandbox:latest`, exposes port 8080, runs entry as root, and currently configures `seccomp:unconfined`.
- Development Compose builds locally, binds `127.0.0.1:8082`, adds `NET_RAW` and `NET_ADMIN`, persists the entire hunter home, and mounts host CLIs read-only.
- Supervisor launches Nginx, browser, VNC bridge, terminal service, code-server, Jupyter, MCP services, and Plugin Center.
- Nginx exposes all workstation panels on one origin. There is no CyberBox capability-token boundary between panels.
- The platform prototype runs separately on 127.0.0.1:8787 and is not part of the Docker dashboard.

## Capability truth table

| Capability | State | Evidence |
|---|---|---|
| Code workspace | Ready | code-server supervised and routed |
| Browser/VNC | Ready after repair | stale profile-lock cleanup; Chromium CDP healthy |
| Terminal | Ready | upstream shell service |
| Jupyter | Ready | supervised Jupyter route |
| Plugin catalog | Preview | registry browse/filter/command handoff |
| Plugin permission runtime | Development stub | no signed permission enforcement |
| MCP registry/policy UI | Unavailable | upstream MCP hub only |
| Projects/ScopeGuard | Development prototype | exists only under `platform/` |
| Evidence/findings/timeline | Development prototype | not connected to Docker surfaces |
| Proxy/traffic workbench | Unavailable | mitmproxy binary only |
| Job system | Development prototype | execution tables exist, no unified workers/UI |
| Workflows | Development prototype | one resumable playbook service |
| Containers panel | Unavailable | no safe control-plane runtime adapter |
| Multi-user isolation | Unavailable | single shared container/home |
| Kubernetes deployment | Unavailable | no manifests/operator |

## Confirmed reliability defects

1. Browser entered Supervisor `FATAL` because persisted Chromium singleton locks referenced an old container hostname. Repaired and guarded at startup.
2. CSBX silently returned an empty registry when PyYAML was missing. Repaired with an explicit dependency gate; image dependency added.
3. Root and development Compose differ materially in ports, security controls, volumes, and user behavior.
4. Health checks report HTTP reachability or command presence, not subsystem readiness.
5. Dashboard ownership depends on patching generated upstream HTML after startup.
6. Plugin Center state is read from mutable YAML without signatures, permission manifests, or lifecycle enforcement.
7. API keys in the platform prototype are stored in plaintext SQLite and the bootstrap key is printed to logs.
8. Platform WebSocket authentication is absent.
9. Caido terminal execution and platform execution do not share ScopeGuard or audit state.
10. Repaired: built-in project profiles now cover the requested domain matrix and retain Red/Blue/Purple compatibility views.
11. Repaired: Rapid7's moving `msfupdate` installer attempted a 406 MB unpinned package and failed after upstream read errors. Metasploit is no longer part of the mandatory core-image build and is reported as an optional `Requires configuration` provider preview.

## Security gaps

- No deny-by-default capability token between browser panels and control APIs.
- No central ScopeGuard applied to CLIs, Caido, browser, MCP, or Plugin Center.
- No rootless runtime profile; development needs elevated network capabilities.
- Writable root filesystem; no capability drop baseline; no PID/disk quota.
- Host gateway access and optional broad Internet access are enabled.
- No workspace separation for malware, forensic, student, or multi-user cases.
- Third-party CSBX install hooks execute shell after an interactive prompt but lack quarantine/signature/permission lifecycle.
- No archive bomb, symlink, or content-type ingestion boundary exists for future uploads.

## Test baseline

Present: Go CLI tests, Bash prowl/CSBX tests, Caido backend unit test, platform foundation tests, SDK tests, evaluation tests, Plugin Center unit test.

Missing: ScopeGuard cross-provider tests, plugin lifecycle tests, evidence hashing integration, multi-user boundary tests, proxy capture tests, and workspace export/re-import tests.

Added on 2026-07-12: the image workflow now starts the built workstation and checks its routes, subsystem health response, Plugin Center dashboard registration, and stale Chromium profile-lock recovery. The unpinned Rapid7 installation step found during local verification was removed from the core image; Metasploit remains a capability-gated optional provider preview.

Also verified on 2026-07-12: Terminal health now follows its real `python-server` session backend instead of the unrelated VNC `websocat` bridge. The runtime suite forces both Terminal and Jupyter unavailable, verifies their honest component state, starts them again, and requires full workstation health recovery.

Browser-driven CI now opens the real Docker dashboard, verifies the Code, Browser, Terminal, Jupyter, and Plugin Center launch controls, loads Plugin Center through its dashboard iframe, checks subsystem health, and fails on browser console errors. The dashboard now receives an idempotent CyberBox favicon, repairing the previously observed `/favicon.ico` 404.

The unified health registry now includes a read-only SQLite integrity probe. An absent, not-yet-promoted control plane is labeled `Preview` without degrading healthy workstation services; a configured valid database is `Ready`; and a corrupt or unreadable configured database is `Degraded` with recovery actions.

Workspace schema `001` now runs before service startup. It creates the private CyberBox state and evidence/report layout, copy-forwards a recognized legacy database without deleting its source or overwriting a current database, records the migration, repairs ownership for the non-root runtime user, and is idempotence-tested. Container readiness is withheld until dashboard integration and its post-reload Plugin Center probe succeed; this repaired a verified transient 502 race.

The primary `./bin/cyberbox` contract now manages the complete Docker workstation on loopback port 8080. The former port-8787 prototype behavior is available only through the explicit `platform` subcommand. Production Compose now persists `/home/hunter`, accepts an explicit image override, uses the correct workspace path, and avoids a fixed container name so production and development projects cannot collide.

Phase 2 promotion began on 2026-07-13: the existing FastAPI control plane now runs as an internal-only Compose sidecar and is routed through `/control/` on the main CyberBox origin. It has no published host port, uses a read-only root filesystem, drops all Linux capabilities, has CPU/memory/PID bounds, stores state in a dedicated volume, and builds from a pinned Python base plus the frozen `uv.lock`. API keys are stored as one-way digests with legacy upgrade-on-use, bootstrap secrets are not logged, WebSocket admission requires authentication, and `/control/health` includes a SQLite integrity check. Live unified health reports all ten components Ready.

Phase 2 foundation continued on 2026-07-13: the control plane now seeds sixteen profiles and thirteen project templates. Template-created projects attach an authorization-pending engagement, record a timeline event, and default to deny-by-default policy with no approved scope rules. Plugin Center profile filters were expanded so every profile has relevant preview integrations, while active and credential-testing tools remain preview or approval-gated.

ScopeGuard foundation continued on 2026-07-13: projects now have normalized target inventory, engagements have explicit scope acknowledgments, and control-plane policy evaluation denies pending, uncertain, expired, blocked, out-of-scope, excluded, wrong-port, wrong-method, destructive, and prohibited actions. Scan creation now requires an authorized/local-lab/CTF engagement, an acknowledgment, and matching scope unless it is legacy active test data. This enforcement currently covers control-plane scans, research experiments, and playbook-triggered executions; browser, terminal, Jupyter, and third-party panel enforcement remain pending capability-token integration.

Capability-token foundation continued on 2026-07-13: the control plane now stores only hashed short-lived capability tokens, binds them to a project and optional engagement, verifies exact permissions, records last use, and supports revocation. The first provider-gated route is artifact creation with `evidence.write`; ordinary user API-key artifact creation remains available for the control UI. Remaining gap: Browser, Terminal, Jupyter, Plugin Center, MCP, and external plugin providers still need to move sensitive operations onto capability-gated provider routes.

Panel bridge continued on 2026-07-13: Plugin Center can now capture an explicit evidence note into a user-specified project without receiving the admin API key. The workstation wrapper generates a local internal service token, the Plugin Center sidecar uses it only to mint short-lived provider capabilities, and artifact writes go through the provider-only control-plane route. Service logs now require `service.read`, restart requires `service.restart`, and registry sync requests and verifies `plugin.registry.sync` before running `csbx sync` locally in the sandbox. A live browser smoke test on the restarted stack confirmed the updated preview labels, the recovered service-log flow, and the runtime-noise filter that trims repeated DBus/browser startup chatter. Command handoff remains a local preview path, not a privileged control-plane action.

Runtime separation continued on 2026-07-13: the control-plane API now exposes an explicit `/runtime` summary so the frontend can show the split between control-plane data and the isolated workspace shell instead of implying a single monolithic process. The frontend no longer defaults to an unmarked fake shell view when API data is present; it now distinguishes demo mode from live project state and displays the shell boundary as a first-class state.

Verified baseline on 2026-07-12: platform 12/12 tests and build pass; Caido 35/35 tests, typecheck, and builds pass after lockfile repair; Go CLI tests/vet pass; Python SDK 6/6 passes; CSBX 8/8, supply-chain wrapper 12/12, guardrails 21/21, prowl doctor 14/14, and Plugin Center tests pass. The Caido `xterm` dependency is deprecated and remains a tracked migration item.

## Immediate decisions

1. The Docker dashboard becomes the product shell.
2. `platform/backend` is promoted into the control plane after hardening; its separate frontend is not a second product shell.
3. All panels consume one project/context API.
4. Providers wrap existing tools; UI never shells arbitrary user strings.
5. Features expose honest capability states from health probes.
6. Active execution remains blocked until ScopeGuard and the job system are authoritative.
