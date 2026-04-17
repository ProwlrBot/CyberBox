# agent-sandbox (Python SDK)

Python SDK for the **CyberSandbox** HTTP API — shipped as part of
[ProwlrBot/CyberBox](https://github.com/ProwlrBot/CyberBox). It talks to the
hardened sandbox container at `ghcr.io/prowlrbot/cybersandbox:latest` and
exposes sync (`Sandbox`) and async (`AsyncSandbox`) clients for shell, file,
browser, code, Jupyter, Node.js, MCP, skills, and cloud provider operations.

The package is API-compatible with upstream `agent-sandbox`; the published
artifact is maintained out of the CyberBox monorepo.

## Installation

```bash
pip install agent-sandbox
# or with uv:
uv add agent-sandbox
```

Start the sandbox container the SDK talks to:

```bash
docker pull ghcr.io/prowlrbot/cybersandbox:latest
docker run --rm -p 8080:8080 ghcr.io/prowlrbot/cybersandbox:latest
```

## 30-second Quick Start

```python
from agent_sandbox import Sandbox

client = Sandbox(base_url="http://localhost:8080")

# Sandbox context (env, installed tools, etc.)
ctx = client.sandbox.get_context()
print(ctx)

# Run a shell command inside the sandbox.
result = client.shell.exec_command(command="echo 'hello from cybersandbox'")
print(result.data.output if result.data else result)
```

Every resource method returns a Pydantic response model (typically
`Response*`) whose `.data` field holds the typed payload. Use
`client.<resource>.with_raw_response` if you need the underlying HTTP
response.

## Async Support

`AsyncSandbox` mirrors the sync client for use inside asyncio / FastAPI / etc.

```python
import asyncio
from agent_sandbox import AsyncSandbox

async def main():
    client = AsyncSandbox(base_url="http://localhost:8080")
    ctx = await client.sandbox.get_context()
    print(ctx)

    result = await client.shell.exec_command(command="ls -la")
    print(result.data.output if result.data else result)

asyncio.run(main())
```

## Modules

The client exposes a property per service. Each returns a resource client
generated from the sandbox OpenAPI spec.

- `client.sandbox` — environment info, installed packages
- `client.shell` / `client.bash` — shell sessions and one-shot commands
- `client.file` — read, write, search, edit, upload
- `client.code` — multi-language code execution
- `client.jupyter` — Jupyter kernel sessions
- `client.nodejs` — Node.js sessions
- `client.browser`, `client.browser_page`, `client.browser_tabs`,
  `client.browser_cookies`, `client.browser_state`, `client.browser_network`,
  `client.browser_captcha` — browser automation surfaces
- `client.mcp` — MCP tool calls
- `client.skills` — sandbox-registered skills
- `client.proxy` — outbound proxy routing
- `client.auth` / `client.util` — helpers

## Cloud Providers

### Volcengine

See [`examples/volcengine-provider`](https://github.com/ProwlrBot/CyberBox/tree/main/examples/volcengine-provider)
for the full script.

```python
import os
from agent_sandbox.providers import VolcengineProvider

provider = VolcengineProvider(
    access_key=os.environ["VOLC_ACCESSKEY"],
    secret_key=os.environ["VOLC_SECRETKEY"],
    region=os.environ.get("VOLCENGINE_REGION", "cn-beijing"),
)

sandbox_id = provider.create_sandbox(function_id="yatoczqh")
print("sandbox:", sandbox_id)
```

## Requirements

- Python 3.8+
- `httpx[socks]`
- `pydantic` (v1 or v2)
- `typing_extensions` (Python < 3.10)

## Links

- [CyberBox monorepo](https://github.com/ProwlrBot/CyberBox)
- [CyberSandbox image](https://github.com/ProwlrBot/CyberBox/pkgs/container/cybersandbox)
- [Issues](https://github.com/ProwlrBot/CyberBox/issues)
- [Examples](https://github.com/ProwlrBot/CyberBox/tree/main/examples)

## License

Apache-2.0
