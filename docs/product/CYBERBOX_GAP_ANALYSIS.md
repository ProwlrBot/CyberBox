# CyberBox Gap Analysis
_Audited: 2026-11-10 | Based on actual file inspection_

## What "actually works" vs what's claimed

| Subsystem | Status | Evidence path | Gap |
|---|---|---|---|
| Docker workstation | WORKING | cybersandbox/Dockerfile, entrypoint, supervisor | seccomp unconfined in prod; no capability drop |
| code-server, browser, terminal, Jupyter | WORKING | supervisor.conf, routes | panels bypass ScopeGuard |
| Plugin Center | WORKING (preview) | cybersandbox/plugin-center/ | no signed permission enforcement |
| control plane (platform/backend) | WORKING prototype | platform/backend/app/cyberbox/ | no frontend connected to it |
| ScopeGuard | WORKING on API paths | platform/backend/app/cyberbox/services/policy.py | browser/terminal/Jupyter not enforced |
| capability tokens | WORKING | platform/backend/app/cyberbox/capabilities.py | only 1 provider route uses them |
| prowl patterns (12 original) | WORKING | prowl/patterns/*/system.md + schema.json | BOLA/IDOR, business logic, WebSocket missing |
| prowl guardrails | WORKING | prowl/bin/prowl-guardrails | not wired to control plane |
| phase_recon CVE pipeline | WORKING | evaluation/phase_recon.py + cve_lookup.py | not a control-plane job type |
| evaluation harness | WORKING (tool eval) | evaluation/main.py, agent_loop.py | 0 security vuln benchmarks |
| leaderboard schema | WORKING | evaluation/leaderboard_schema.json | no security metrics (now added) |
| Raptor source scanner | WORKING standalone | /home/anon/raptor/ (13 protocols, 211 templates) | not a control-plane job type |
| Prowlr Studio (mobile) | WORKING | /home/anon/prowlr-studio/ | separate app, not in CyberBox |
| claude-bug-bounty agents | WORKING in Claude Code | /home/anon/claude-bug-bounty/agents/*.md | not wired to CyberBox job/sandbox system |
| platform scanner service | WORKING | platform/backend/app/cyberbox/scanner.py | results don't reach evidence/findings UI |
| platform research service | WORKING | platform/backend/app/cyberbox/research.py | hypothesis → finding chain, no UI |
| platform memory service | WORKING | platform/backend/app/cyberbox/memory.py | not connected to hunt-memory/ |
| plugins/ directory | EMPTY | /home/anon/CyberBox/plugins/ | placeholder only |
| attack surface graph | MISSING | nowhere | — |
| multi-agent coordinator | MISSING | nowhere | — |
| hunt dashboard (UI) | MISSING from main app | canvases/ exists in claude-bug-bounty | disconnected |

---

## Prowl Pattern Coverage

| Attack Class | Pattern | Pays in BB? | Status |
|---|---|---|---|
| SSRF chain | ssrf_chain | High | ✅ |
| CORS misconfiguration | cors_audit | Medium | ✅ |
| OAuth/OIDC | oauth_misconfig | High | ✅ |
| JWT | jwt_audit | Medium | ✅ |
| GraphQL recon | graphql_recon | Medium | ✅ |
| Header misconfiguration | header_misconfig_audit | Low | ✅ |
| Race condition | race_condition_hypotheses | High | ✅ |
| Secret diffing | diff_for_secrets | Medium | ✅ |
| Vuln triage | analyze_vulns + triage_nuclei | Medium | ✅ |
| Endpoint extraction | extract_endpoints | Low | ✅ |
| Report writing | write_report | — | ✅ |
| **BOLA/IDOR** | **bola_idor** | **Critical** | **✅ added 2026-11-10** |
| **Business logic** | **business_logic_audit** | **Critical** | **✅ added 2026-11-10** |
| **WebSocket auth** | **websocket_auth** | **High** | **✅ added 2026-11-10** |
| **Differential/multi-role** | **differential_auth** | **Critical** | **✅ added 2026-11-10** |
| **File upload chain** | **file_upload_chain** | **High** | **✅ added 2026-11-10** |
| **Mass assignment** | **mass_assignment** | **High** | **✅ added 2026-11-10** |
| GraphQL introspection→BOLA | MISSING | High | ❌ |
| Account takeover chain | MISSING | Critical | ❌ |

---

## The Core Integration Gap

The claude-bug-bounty harness and the CyberBox control plane are **two separate working systems** with no bridge:

```
claude-bug-bounty/                      CyberBox/
  agents/autopilot.md                     platform/backend/ (control plane)
  agents/validator.md                     cybersandbox/ (Docker workstation)
  agents/report-writer.md                 prowl/ (vuln patterns)
  hunt-memory/                            evaluation/ (benchmark harness)
  programs/                               
  playbook/                               
  tools/brain.py (111KB)                  
  tools/autopilot_runner.py               
```

**Wire needed:** A job type in the control plane that invokes claude-bug-bounty agents, feeds scope from ScopeGuard, and stores results in the platform evidence/findings tables.

---

## Priority Implementation Queue

### P0 — Non-destructive, immediate value
1. ✅ 3 new prowl patterns (bola_idor, business_logic_audit, websocket_auth) — DONE
2. ✅ Security eval datasets (evaluation_security_tools.xml) — DONE  
3. ✅ Leaderboard security metrics extension — DONE
4. ✅ Competitive matrix (docs/product/) — DONE

### P1 — Wire existing systems together
5. ✅ Prowl pattern → platform hypothesis bridge (`prowl/bin/prowl-to-hypothesis`) — DONE
   - Handlers for all 7 patterns, dry-run validated, guardrails integrated
   
6. ✅ Raptor as control-plane job type — DONE
   - `run_raptor_scan()`, `POST /projects/{id}/raptor-scan`, dispatch/recover, 6/6 tests pass

7. ✅ Hunt-memory sync to platform memory — DONE
   - `prowl/bin/sync-hunt-memory`, idempotent sha256 keying, dry-run shows 14 files / 7 targets

### P2 — Close the leaderboard gap vs XBOW
8. ✅ Security eval on local vuln apps — DONE
   - `evaluation/dataset/evaluation_security_webapp.xml` — 24 tasks, 12 categories
   - crAPI (BOLA, mass-assign, BFLA, business-logic) + DVWA (file upload) + prowl + raptor tasks

9. ✅ Add 3 new high-value prowl patterns — DONE
   - `differential_auth` (multi-role A×B matrix), `file_upload_chain` (SVG XSS→polyglot→ImageMagick),
     `mass_assignment` (response-leak candidates) — all schema-valid, tests PASS

10. ✅ Hunt dashboard wired to platform API — DONE
    - `platform/backend/cyberbox/static/hunt_dashboard.html` — hypothesis feed, execution feed,
      pattern coverage grid; `/api/v1/dashboard` route; live 30s polling

### P3 — Commercial differentiation
11. ✅ crAPI + DVWA containers wired into cybersandbox — DONE
    - `cybersandbox/docker-compose.vuln-targets.yml` — crAPI (Postgres+Mongo+Mailhog) at :8888,
      DVWA at :4280, loopback-only, works standalone or as compose override
12. Published benchmark: run `evaluation_security_webapp.xml` on live crAPI, record score
13. cost-per-finding metric in leaderboard (model token cost / confirmed findings)
14. Duplicate detection: semantic fingerprinting across hunt-memory entries

---

## Running Tests

### Evaluation harness (leaderboard schema, phase_recon, etc.)
```bash
cd /home/anon/CyberBox/evaluation
uv run pytest tests/ -v
```

### Platform backend (control plane services)
```bash
cd /home/anon/CyberBox/platform/backend
uv run --extra dev pytest tests/test_wordfence.py -v          # fast, 3 tests, ~0.4s
uv run --extra dev pytest tests/ -v --tb=short                # full suite (test_foundation.py has async startup slowness)
```
_Fixed 2026-11-10: added `[project.optional-dependencies] dev = ["pytest>=8.0", "httpx>=0.27.0"]` and `[tool.pytest.ini_options] pythonpath = ["."]` to `pyproject.toml` so pytest runs in the project venv with `cyberbox` on the path._

### Prowl patterns (bash-based)
```bash
cd /home/anon/CyberBox/prowl
bash tests/test_pattern_bola_idor.sh
bash tests/test_pattern_business_logic_audit.sh
bash tests/test_pattern_websocket_auth.sh
# Or all patterns at once:
for f in tests/test_pattern_*.sh; do bash "$f"; done
```
