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
      text: Get Started
      link: /guide/start/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/ProwlrBot/CyberBox
  image:
    src: /brand/icon.svg
    alt: CyberBox Logo

features:
  - title: Unified Workspace
    details: One Docker container, shared filesystem across Terminal, VSCode, Jupyter, and the Caido proxy — no context switching.
    icon: 🌐
  - title: Tools Out of the Box
    details: 160+ pre-installed offensive and defensive tools (nuclei, subfinder, httpx, katana, dalfox, caido, and more).
    icon: ⚡
  - title: Secure Execution
    details: Isolated Python and Node.js sandboxes with NeMo Guardrails — run untrusted payloads without touching the host.
    icon: 🔐
  - title: Agent-Ready
    details: MCP server exposes shell, browser, files, code, and Caido — ready for Claude, Ollama, and custom agents.
    icon: 🤖
  - title: Developer Friendly
    details: Cloud VSCode, persistent terminals, smart port forwarding (via `${Port}-${domain}/` or `/proxy`), instant previews.
    icon: 🔧
  - title: Production Ready
    details: Signed container images (cosign + SBOM), GHCR-published, Trivy-scanned supply chain. Built to scale.
    icon: 🚀
---
