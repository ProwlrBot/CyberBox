# Marketplace & repo description copy

Source-of-truth marketing copy that lives **in the repo**. Anytime the
GitHub repo description, the Caido marketplace listing, GHCR package
description, or the prowlrbot.com tagline drifts, update it here first
and propagate.

All variants lead with the **supply-chain trust pillar** per
[`.auto-claude/specs/008-supply-chain-trust-documentation-pillar/spec.md`](./.auto-claude/specs/008-supply-chain-trust-documentation-pillar/spec.md).

---

## 1. GitHub repo description (≤ 350 chars)

> **Cosign-signed, SBOM-shipped, Trivy-gated Docker workspace for bug bounty
> hunters.** 160+ tools, dual AI (Claude + Ollama), Caido proxy, MCP server.
> Verify before you run — every image is reproducible from a fresh runner via
> public Sigstore + Rekor.

Tags / topics: `bug-bounty`, `security`, `cosign`, `sigstore`, `sbom`, `slsa`,
`supply-chain-security`, `caido`, `docker`, `mcp`, `claude`, `ollama`,
`offensive-security`.

Homepage URL: `https://prowlrbot.com/cyberbox/guide/trust`

## 2. Caido marketplace listing — Prowlr plugin

### Title (≤ 60 chars)

> Prowlr — Scope, AI analysis, Obsidian export

### Short description (≤ 140 chars)

> Trust-first Caido companion: scope guard, dual-LLM AI analysis with
> NemoClaw guardrails, Obsidian findings export. Backed by a cosign-signed
> sandbox.

### Long description

CyberBox + Prowlr is the bug-bounty workflow for hunters who want to **verify
their tooling before they trust it**.

**Why supply-chain trust comes first.** Every CyberBox container image is
keyless-signed with cosign (Sigstore Fulcio + public Rekor log), ships a full
SPDX SBOM, carries SLSA build provenance, and is gated on Trivy CRITICAL CVEs
before publishing. An independent verify-supply-chain CI job re-checks the
signature and SBOM on a fresh runner with no build cache — and you can
reproduce that verification locally in under two minutes. Walkthrough:
https://prowlrbot.com/cyberbox/guide/trust

**What Prowlr adds inside Caido.**

- **Scope enforcement** — block out-of-scope traffic at the proxy, not after.
- **Dual-LLM AI analysis** — Claude (cloud) for deep reasoning, Ollama
  (local) for on-engagement air-gapped review. Same UI, switch per request.
- **NemoClaw-style guardrails** — 7 prompt-injection patterns filtered from
  traffic before reaching the LLM; 6 secret classes (sk-ant-, AKIA, ghp\_,
  JWT, etc.) redacted from AI responses.
- **Obsidian export** — push findings to a local vault as templated
  Markdown, ready for triage.
- **Embedded terminal** — minimal xterm.js tab; pair with ShadowShell for
  serious multi-tab terminal work.

**Pairs with:**

- `cybersandbox` Docker image — 160+ pre-installed tools, signed and
  SBOM-attested.
- `harbinger` — autonomous recon → scan → report pipeline.
- `csbx` — community plugin manager (Homebrew-tap style).
- `invoke-claude` / `invoke-ollama` — uniform CLI wrappers for both AI
  providers.

**Verify before you install:** see the trust guide for the cosign verify
command, SBOM inspection (syft/grype), and Rekor lookup.

### Listing tags

`scope`, `ai`, `claude`, `ollama`, `obsidian`, `terminal`, `cosign`,
`sbom`, `supply-chain`, `bug-bounty`.

## 3. GHCR package description

> **ghcr.io/prowlrbot/cybersandbox** — hardened bug-bounty workspace,
> cosign keyless-signed (Fulcio + Rekor), SBOM-attested, SLSA provenance,
> Trivy CRITICAL-gated. Verify: https://prowlrbot.com/cyberbox/guide/trust

## 4. prowlrbot.com landing tagline

> **Verify before you run.** CyberBox is the only bug-bounty workspace
> that ships cosign keyless signatures, SPDX SBOMs, and SLSA provenance
> by default. 160+ tools, dual AI, Caido proxy — reproducible from a
> fresh runner in under two minutes.

## 5. Social-card / OG fallback (≤ 200 chars)

> CyberBox — cosign-signed, SBOM-shipped, Trivy-gated bug-bounty workspace.
> Verify your tooling before you trust it. 160+ tools, dual AI, Caido
> proxy. https://prowlrbot.com/cyberbox/guide/trust

---

## Update protocol

1. Edit this file and open a PR.
2. After merge, propagate to:
   - GitHub: `gh repo edit ProwlrBot/CyberBox --description "..." --homepage "https://prowlrbot.com/cyberbox/guide/trust"`
   - Caido marketplace: paste section 2 into the listing form.
   - GHCR: edit package description on the GHCR web UI.
   - prowlrbot.com: section 4 lands in the marketing site repo.
3. Note the propagation in the commit body so the next editor knows where
   the live copy lives.
