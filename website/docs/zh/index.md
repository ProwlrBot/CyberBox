---
pageType: home

hero:
  name: CyberBox
  text: |
    面向安全研究与 AI Agent 的
    一体化 Docker 工作空间
  tagline: |
    🌐 Caido 代理 | 💻 终端 | 📁 文件

    🔧 VSCode | 📊 Jupyter | 🤖 双 AI (Claude + Ollama) | 🧰 160+ 工具
  actions:
    - theme: brand
      text: 开始使用
      link: /zh/guide/start/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/ProwlrBot/CyberBox
  image:
    src: /brand/icon.svg
    alt: CyberBox Logo

features:
  - title: 统一工作空间
    details: 单一 Docker 容器、共享文件系统，终端 / VSCode / Jupyter / Caido 代理无缝切换。
    icon: 🌐
  - title: 工具开箱即用
    details: 预装 160+ 进攻与防御工具（nuclei、subfinder、httpx、katana、dalfox、caido 等）。
    icon: ⚡
  - title: 安全执行
    details: 隔离的 Python 与 Node.js 沙盒，配合 NeMo Guardrails，可安全运行未知 payload。
    icon: 🔐
  - title: AI Agent 就绪
    details: MCP 服务器暴露 shell、浏览器、文件、代码与 Caido，适配 Claude、Ollama 及自研 Agent。
    icon: 🤖
  - title: 开发者友好
    details: 云端 VSCode、持久终端、智能端口转发（通过 `${Port}-${domain}/` 或 `/proxy`），即时预览。
    icon: 🔧
  - title: 生产就绪
    details: 镜像由 cosign 签名并附带 SBOM，通过 GHCR 发布，Trivy 持续扫描供应链，可规模化部署。
    icon: 🚀
---
