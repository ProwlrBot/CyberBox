# LangGraph + DeepAgents (integration example)

> **Inherited from upstream [ProwlrBot/CyberBox](https://github.com/ProwlrBot/CyberBox).** This example still targets the upstream image and wording; CyberBox is API-compatible and works as a drop-in replacement by substituting `ghcr.io/prowlrbot/cybersandbox:latest`. The canonical CyberBox SDK surface is documented in [`sdk/python/README.md`](../../sdk/python/README.md).

A LangGraph-based deep agent implementation that uses the sandbox as a native DeepAgents backend, implementing the `BaseSandbox` protocol (`execute`, `upload_files`, `download_files`).

## Features

- **Native Sandbox Backend**: Direct integration via DeepAgents sandbox protocol
- **OpenAI Compatible**: Supports various LLM providers through OpenAI-compatible API
- **Streaming Support**: Real-time response streaming

## Prerequisites

- Python 3.12 or higher
- Docker (for running CyberBox)
- An OpenAI-compatible API key (OpenRouter, etc.)

## Quick Start

### 1. Start CyberBox Docker Sandbox

**For International Users:**
```bash
docker run --security-opt seccomp=unconfined --rm -it -p 8080:8080 ghcr.io/prowlrbot/cybersandbox:latest
```

**For Users in Mainland China:**
```bash
docker run --security-opt seccomp=unconfined --rm -it -p 8080:8080 enterprise-public-cn-beijing.cr.volces.com/vefaas-public/cybersandbox:latest
```

More information:
- [CyberBox Guide](https://sandbox.agent-infra.com/)

### 2. Setup Environment

```bash
uv venv
uv sync
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your API details:
```bash
OPENAI_API_KEY=sk-xxxxx
OPENAI_MODEL_ID=anthropic/claude-sonnet-4
OPENAI_BASEURL=https://openrouter.ai/api/v1
SANDBOX_URL=http://localhost:8080
```

### 4. Run the Agent

```bash
uv run main.py
```

## Architecture

```
DeepAgents Agent
    └── AIOSandboxBackend (sandbox_backend.py)
        ├── execute(cmd)       → client.bash.exec()
        ├── upload_files()     → client.file.write_file()
        └── download_files()   → client.file.read_file()
            └── agent-sandbox SDK → CyberBox HTTP API
```

This follows the same pattern as `langchain-daytona`, `langchain-runloop`, etc.

## Project Structure

```
aio-deepagents/
├── main.py              # Main entry point
├── sandbox_backend.py   # AIOSandboxBackend — DeepAgents sandbox protocol impl
├── pyproject.toml       # Project configuration and dependencies
├── .env.example         # Environment variables template
└── README.md            # This file
```

## Customization

- **Change the question**: Modify the content in the `astream` call in `main.py`
- **Update instructions**: Change the `system_prompt` parameter
- **Switch models**: Update the `OPENAI_MODEL_ID` environment variable

## License

This project is licensed under the terms specified in the LICENSE file.
