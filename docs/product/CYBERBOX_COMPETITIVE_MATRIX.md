# CyberBox Competitive Matrix
_Last updated: 2026-11-10 | Source: primary vendor docs + public disclosures_

## TL;DR

CyberBox's moat is not attack breadth — it's **researcher intelligence that compounds over time**.
XBOW/BugBunny are black-box attack engines aimed at enterprise buyers.
CyberBox is an *operating system for the researcher*: memory, economics, bias detection, independent validation, and a wired tool ecosystem that improves every session.

---

## Capability Matrix

| Capability | XBOW | BugBunny.ai | RedAmon | CyberBox |
|---|:---:|:---:|:---:|:---:|
| **Autonomous attack agents** | ✅ | ✅ | ✅ | Partial (claude-bug-bounty agents, not wired to sandbox) |
| **Researcher hunt memory** | ✗ | ✗ | ✗ | ✅ hunt-memory/ + autopilot |
| **Multi-program research OS** | ✗ | ✗ | ✗ | Partial (platform prototype) |
| **BYOK / local models** | ✗ | ✗ | ✅ | ✅ (ollama, lmstudio MCPs in sandbox) |
| **Open source / self-hosted** | ✗ | ✗ | ✅ | ✅ |
| **Duplicate intelligence** | ✗ | ✗ | ✗ | Partial (loss-curator agent) |
| **Independent validator agent** | ✗ | Partial | ✗ | ✅ (validator + skeptic agents) |
| **Research economics ($/hr)** | ✗ | ✗ | ✗ | ✅ payout-analyst |
| **Bias detection** | ✗ | ✗ | ✗ | ✅ bias-detector |
| **Caido/proxy native integration** | ✗ | ✗ | ✗ | Partial (Prowlr plugin + caido_mcp) |
| **Business logic testing** | ✗ | ✗ | ✗ | Partial (chain-builder) |
| **Scope enforcement (ScopeGuard)** | Partial | ✗ | Partial (approval gates) | ✅ (architecture + ScopeGuard API, panel enforcement pending) |
| **Mobile (MASVS/MASTG)** | ✗ | Partial | ✗ | ✅ Prowlr Studio + mobile agent |
| **Source code analysis** | ✗ | Partial (repo connect) | ✗ | ✅ Raptor (13 protocols, 211 templates) |
| **MCP agent ecosystem** | ✗ | ✗ | ✅ | ✅ 30+ MCP plugins |
| **Fix delivery (PR)** | ✗ | ✅ | Partial | ✗ |
| **Benchmarks (public)** | ✅ H1 leaderboard #1 (vendor claim) | ✗ | 101/104 XBOW (developer claim) | ✗ (leaderboard infra built, no security evals yet) |

---

## Competitor Detail

### XBOW
- **What it actually does:** Coordinator spawns bounded solver agents per attack objective. AI explores, deterministic engine validates exploitability. Human reviews before submission.
- **Attack classes:** Web technical flaws (SQLi, XSS, SSRF, LFI chains), API misconfigs, some auth bypass. Can chain SSRF→LFI.
- **Self-admitted gaps:** Business logic (explicitly stated). Multi-step ATO. No mobile, cloud, source code, or binary. Black-box only.
- **Business model:** Enterprise SaaS only. $75M Series B (Jun 2025). Not available to individual researchers.
- **Key claim:** HackerOne US leaderboard #1 June 2025 (~1,060 attacks: 54 critical, 242 high). Later claimed global #1.
- **Verification:** Vendor claim. H1 leaderboard position is verifiable; attack counts and severity breakdown are vendor-reported.
- _Source: TechSpot 2025-06-25, HelpNetSecurity 2025-06-25, XBOW blog_

### BugBunny.ai
- **What it actually does:** 24/7 AI security engineer. Black-box from URL + white-box from connected source repo. Opens PRs with fixes. Covers web, mobile, smart contracts, cloud (AWS/GCP/Azure).
- **Attack classes:** Web, mobile, blockchain/smart contracts, cloud IAM. Claims 110+ CVEs (vendor claim).
- **Self-admitted gaps:** Results provided "as is, may require human review" (from their own ToS). Defender/AppSec focus, not offensive researcher. No hunt memory or duplicate avoidance between programs.
- **Business model:** $100/mo platform + PAYG, or $49/mo Strike plan with 100 audit credits.
- **Key claim:** Only AI that also opens the fix PR — full detect-to-remediate loop.
- _Source: bugbunny.ai homepage, AgentCommunity profile, ToS (2026)_

### RedAmon
- **What it actually does:** Open-source self-hosted ReAct agent with 40+ tools (Subfinder, Amass, Naabu, Masscan, Nuclei, Metasploit, Hydra). Neo4j attack-surface graph. Human approval gates before high-impact tools. MCP bidirectional — driveable from Claude Code.
- **Attack classes:** Network + web + post-exploitation. Standard tool fleet, not specialized per vuln class.
- **Self-admitted gaps:** No research memory across programs. No multi-tenant. No researcher economics or duplicate intelligence. Primarily a pentest framework.
- **Business model:** Free / open source (self-hosted).
- **Key claim:** MCP bidirectional, Neo4j graph reasoning, 101/104 XBOW challenge score (developer claim, not independently verified).
- _Source: github.com/samugit83/redamon, CybersecurityNews, redamon.org/docs_

### Caido / Burp Suite + AI
- **What it actually does:** Human-led proxy interception, replay, workflows. Caido's AI is a workflow assistant (describe attack class → Caido generates workflow); Burp AI is a scan helper.
- **Gap vs CyberBox:** Neither has hunt memory, researcher economics, or cross-session intelligence. CyberBox's Prowlr plugin already integrates Caido's traffic into the hunt pipeline — this is an advantage, not a threat.

---

## GitHub Tools to Wire (Not Rebuild)

| Tool | Stars | What it does | Integration path |
|---|---|---|---|
| **samugit83/redamon** | ~400 | LangGraph ReAct + 40-tool MCP fleet + Neo4j graph | Wire as optional MCP provider behind ScopeGuard |
| **Armur-Ai/Pentest-Swarm-AI** | 3.2k | Go swarm — recon, classification, exploitation, reporting | Adapt coordinator pattern for CyberBox job system |
| **H-mmer/pentest-agents** | 1.1k | 48+ Claude agents, 26 commands, 2 MCP servers, autonomous hunt loop | Direct overlap — review for skill sync |
| **ProjectDiscovery ecosystem** | >50k | Nuclei/httpx/subfinder/katana — template-based discovery | Already in cybersandbox; wire as typed providers |
| **bbrf-client** | ~200 | Distributed scope management, asset tracking across tools | Wire as scope source for ScopeGuard |
| **Raptor** (local) | — | 13-protocol source scanner, 211 templates, 285 rules, SARIF output | Already built; add as control-plane job type |

---

## CyberBox Defensible Differentiators

These are **implemented** (even if not yet fully wired), not marketing claims:

1. **Research memory that learns**: hunt-memory/ per target, bias-detector, payout-analyst, loss-curator — none of the competitors have this.
2. **Independent validation**: validator + skeptic agents with opposing incentives. XBOW validates internally; no competitor has a separate validator that tries to *disprove* the original claim.
3. **Source analysis**: Raptor with 13 protocols covers MCP servers, npm packages, Go, PHP, GHA, Crystal, JS/TS — XBOW is black-box only.
4. **Local/BYOK**: ollama + lmstudio MCPs mean private targets never leave the machine. XBOW and BugBunny are cloud-only.
5. **Researcher economics**: payout-analyst tracks $/hr, ROI per vuln class. No competitor tracks this.
6. **Mobile**: Prowlr Studio has mitmproxy, ADB replay, Frida, full MASVS workflow. XBOW has nothing.
7. **Scope enforcement**: ScopeGuard API with capability tokens. Competitors have soft approval gates or nothing.

---

## What CyberBox Is Missing (Priority Order)

| Gap | Impact | Effort | Status |
|---|---|---|---|
| **Security-specific eval datasets** | High — no published benchmark to show XBOW we're serious | Low — eval harness already built | MISSING |
| **claude-bug-bounty → CyberBox wired** | Critical — 20 agents disconnected from the sandbox | Medium — integration bridge needed | MISSING |
| **Dashboard hunt state** | High — agents work but aren't visible in CyberBox UI | Medium — control plane API exists | MISSING |
| **Raptor as control-plane job** | Medium — source analysis works standalone, not in job system | Low — job type addition | MISSING |
| **Security leaderboard metrics** | Medium — schema has pass_rate but no vuln_classes/FP_rate | Low — schema extension | MISSING |
| **ScopeGuard in browser/terminal panels** | High — architecture claims it, panels don't enforce it | Medium — capability token integration | PARTIAL |
| **Competitive benchmark (public)** | High — XBOW published HackerOne leaderboard #1 | High — needs live bug bounty results | MISSING |
