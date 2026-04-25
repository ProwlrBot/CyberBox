---
pageType: home

hero:
  name: CyberBox
  text: |
    All-in-One Docker Security
    Workspace for Hunters & Agents
  tagline: |
    🌐 Caido Proxy | 💻 Terminal | 📁 Files

    🔧 VSCode | 📊 Jupyter | 🤖 Dual AI (Claude + Ollama) | 🧰 160+ Tools
  actions:
    - theme: brand
      text: Verify the supply chain
      link: /guide/trust
    - theme: alt
      text: Get Started
      link: /guide/start/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/ProwlrBot/CyberBox
  image:
    src: /brand/banner.png
    alt: CyberBox Logo

features:
  - title: Verifiable supply chain
    details: Every image is cosign keyless-signed (Fulcio + Rekor), ships an SBOM, carries SLSA provenance, and is gated on Trivy CRITICAL. Reproduce the verify in under 2 minutes.
    icon: 🛡️
    link: /guide/trust
  - title: Unified workspace
    details: One Docker container, shared filesystem across Terminal, VSCode, Jupyter, and the Caido proxy — no context switching.
    icon: 🌐
  - title: Tools out of the box
    details: 160+ pre-installed offensive and defensive tools (nuclei, subfinder, httpx, katana, dalfox, caido, and more).
    icon: ⚡
  - title: Secure execution
    details: Isolated Python and Node.js sandboxes with NeMo Guardrails — run untrusted payloads without touching the host.
    icon: 🔐
  - title: Agent-ready
    details: MCP server exposes shell, browser, files, code, and Caido — ready for Claude, Ollama, and custom agents.
    icon: 🤖
  - title: Developer friendly
    details: Cloud VSCode, persistent terminals, smart port forwarding (via `${Port}-${domain}/` or `/proxy`), instant previews.
    icon: 🔧
---
