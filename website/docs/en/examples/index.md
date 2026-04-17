# Examples

Practical integration guides for using CyberBox in real-world scenarios. All
snippets below match the current CyberBox SDK surface (`agent-sandbox` on
PyPI, `@agent-infra/sandbox` on npm). If you spot drift, the SDK source is
authoritative — see [`sdk/python/README.md`](https://github.com/ProwlrBot/CyberBox/blob/main/sdk/python/README.md)
and [`sdk/js/README.md`](https://github.com/ProwlrBot/CyberBox/blob/main/sdk/js/README.md).

## Quick Examples

### Terminal Integration
Learn how to integrate the WebSocket terminal into your applications:
- [Basic Terminal Client](/examples/terminal) - Simple terminal integration
- [Advanced Terminal Features](/examples/terminal#advanced-features) - Session management and reconnection

### Browser Automation
Explore browser automation capabilities:
- [Browser Use Integration](/examples/browser) - Python browser automation
- [Playwright Integration](/examples/browser#playwright) - Advanced browser control
- [Web Scraping Examples](/examples/browser#scraping) - Data extraction patterns

### Agent Integration
Build AI agents with CyberBox:
- [Basic Agent Setup](/examples/agent) - Connect agents to sandbox
- [MCP Integration](/examples/agent#mcp) - Use Model Context Protocol
- [Multi-Tool Workflows](/examples/agent#workflows) - Combine multiple APIs

## Integration Patterns

### Docker Compose Setup
```yaml
version: '3.8'
services:
  cybersandbox:
    image: ghcr.io/prowlrbot/cybersandbox:latest
    ports:
      - "8080:8080"
    volumes:
      - sandbox_data:/workspace
    restart: unless-stopped

volumes:
  sandbox_data:
```

### Kubernetes Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cybersandbox
spec:
  replicas: 2
  selector:
    matchLabels:
      app: cybersandbox
  template:
    metadata:
      labels:
        app: cybersandbox
    spec:
      containers:
      - name: sandbox
        image: ghcr.io/prowlrbot/cybersandbox:latest
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
---
apiVersion: v1
kind: Service
metadata:
  name: cybersandbox-service
spec:
  selector:
    app: cybersandbox
  ports:
  - port: 80
    targetPort: 8080
  type: LoadBalancer
```

## SDK Examples

### Python SDK

Install the Python SDK:

```bash
pip install agent-sandbox
# or with uv:
uv add agent-sandbox
```

#### Basic Configuration

The SDK ships `Sandbox` (sync) and `AsyncSandbox` (async). Both accept
`base_url`, `timeout`, `headers`, `follow_redirects`, and `httpx_client`.
There is no `retries` / `retry_delay` option — pass a pre-configured
`httpx.Client` / `httpx.AsyncClient` if you need custom transport behaviour.

```python
from agent_sandbox import Sandbox

client = Sandbox(
    base_url="http://localhost:8080",  # CyberBox URL
    timeout=30.0,                      # seconds
)
```

Every resource method returns a Pydantic model (`Response*`) with four
fields: `success`, `message`, `data`, `hint`. The typed payload is on
`.data`.

#### Shell Operations

Execute commands and manage shell sessions via `client.shell.exec_command`.
Sessions are addressed by `id` (optional — one is created for you if
omitted); pass the same `id` on subsequent calls to keep state.

```python
# Run a one-shot command
result = client.shell.exec_command(command="ls -la")
if result.success and result.data:
    print("Output:", result.data.output)
    print("Exit code:", result.data.exit_code)

# Pin a session id to persist cwd / env across calls
session_id = "my-session-1"
client.shell.exec_command(
    command="cd /workspace && pwd",
    id=session_id,
)
client.shell.exec_command(command="ls", id=session_id)

# Fire-and-forget long-running command
client.shell.exec_command(
    command="python long_script.py",
    async_mode=True,
    id=session_id,
)

# Read back buffered output
view = client.shell.view(id=session_id)
if view.data:
    print(view.data.output)
```

Async variant — replace `Sandbox` with `AsyncSandbox` and `await` each call:

```python
import asyncio
from agent_sandbox import AsyncSandbox

async def main() -> None:
    client = AsyncSandbox(base_url="http://localhost:8080")
    result = await client.shell.exec_command(command="uptime")
    if result.data:
        print(result.data.output)

asyncio.run(main())
```

#### File Operations

The file resource uses `read_file` / `write_file` / `list_path` /
`find_files` / `search_in_file` / `grep_files`. There is no `file.read`
or `file.list` alias.

```python
# Write a file
client.file.write_file(
    file="/tmp/example.py",
    content=(
        "import numpy as np\n"
        "print(np.arange(10))\n"
    ),
)

# Read a file
read = client.file.read_file(file="/tmp/example.py")
if read.data:
    print(read.data.content)

# List a directory (recursive)
listing = client.file.list_path(path="/tmp", recursive=True)
if listing.data:
    for entry in listing.data.files:
        print(f"{entry.name}: {entry.size} bytes")

# Regex-search within a single file
search = client.file.search_in_file(
    file="/tmp/example.py",
    regex=r"import \w+",
)
if search.data:
    for match in search.data.matches:
        print(f"line {match.line}: {match.content}")

# Find files by name / glob pattern under a path
found = client.file.find_files(path="/tmp", glob="*.py")

# Grep across multiple files
grepped = client.file.grep_files(path="/tmp", pattern="TODO")
```

#### Code Execution

Jupyter (stateful, persistent kernel sessions):

```python
jupyter_result = client.jupyter.execute_code(
    code=(
        "import pandas as pd\n"
        "df = pd.DataFrame({'x': range(5), 'y': range(5, 10)})\n"
        "print(df)\n"
    ),
    timeout=60,
    session_id="data-analysis-session",   # keep kernel state across calls
)

if jupyter_result.data:
    for output in jupyter_result.data.outputs:
        if output.output_type == "stream":
            print(output.text)
        elif output.output_type == "execute_result":
            print(output.data.get("text/plain", ""))
```

Node.js (stateful):

```python
nodejs_result = client.nodejs.execute_code(
    code="console.log(process.version)",
    timeout=30,
)
if nodejs_result.data:
    print(nodejs_result.data.stdout)
```

One-shot multi-language execution via `client.code` (stateless):

```python
py = client.code.execute_code(language="python", code="print(2 + 2)")
if py.data:
    print(py.data)
```

#### MCP Integration

MCP methods are namespaced with the `mcp_` prefix and the arguments payload
is a single `request` dict (not `arguments=`):

```python
# List configured MCP servers
servers = client.mcp.list_mcp_servers()
print("MCP servers:", servers.data)

# List tools from a specific server
tools = client.mcp.list_mcp_tools(server_name="browser")
if tools.data:
    for tool in tools.data.tools:
        print(tool.name, "-", tool.description)

# Execute a tool — server_name / tool_name are POSITIONAL,
# the argument payload goes through `request=`
shot = client.mcp.execute_mcp_tool(
    "browser",
    "screenshot",
    request={
        "url": "https://example.com",
        "width": 1920,
        "height": 1080,
    },
)
```

#### Error Handling

Resource methods return `Response*` models — check `.success` and `.data`
rather than relying on exceptions. `httpx`-level failures (timeout, DNS,
connection refused) will raise from the underlying client.

```python
try:
    result = client.shell.exec_command(command="potentially-failing-command")
    if not result.success:
        print("command failed:", result.message)
    elif result.data and result.data.exit_code != 0:
        print("non-zero exit:", result.data.exit_code)

    # Sandbox health / environment info
    ctx = client.sandbox.get_context()
    if ctx.data:
        print("system env:", ctx.data)
except Exception as e:
    # Transport error — socket, DNS, timeout, etc.
    print(f"transport error: {e}")
```

### Node.js SDK

```bash
pnpm add @agent-infra/sandbox
# or: npm install @agent-infra/sandbox
```

#### Basic Configuration

The JS client constructor takes `environment` (base URL), plus optional
`timeoutInSeconds`, `maxRetries`, and `headers`. There is no `baseUrl`,
`timeout` (ms), `retries`, or `retryDelay` option — those were
upstream names that no longer exist.

```typescript
import { SandboxClient } from "@agent-infra/sandbox";

const client = new SandboxClient({
  environment: process.env.SANDBOX_API_URL ?? "http://localhost:8080",
  timeoutInSeconds: 30,
  maxRetries: 3,
});
```

Every method returns an `HttpResponsePromise` resolving to an `APIResponse`
discriminated union. Always narrow on `res.ok` before reading `res.body`:

```typescript
const res = await client.shell.execCommand({ command: "uname -a" });
if (res.ok) {
  console.log(res.body.data?.output);
} else {
  console.error("API error:", res.error);
}
```

#### Shell Execution

```typescript
const res = await client.shell.execCommand({
  command: "ls -la",
});
if (res.ok) {
  console.log("output:", res.body.data?.output);
  console.log("exit code:", res.body.data?.exit_code);
}

// Persist state across calls by pinning the session id.
const sessionId = "my-session-1";
await client.shell.execCommand({ command: "cd /workspace", id: sessionId });
const listing = await client.shell.execCommand({ command: "ls", id: sessionId });
```

#### File Management

```typescript
const listing = await client.file.listPath({
  path: "/workspace",
  recursive: true,
});
if (listing.ok) {
  console.log(listing.body.data?.files);
}

const read = await client.file.readFile({ file: "/workspace/README.md" });
if (read.ok) {
  console.log(read.body.data?.content);
}

await client.file.writeFile({
  file: "/tmp/hello.txt",
  content: "hello, sandbox",
});
```

#### Jupyter Code Execution

```typescript
const res = await client.jupyter.executeCode({
  code: "print('Hello, Jupyter!')",
  kernelName: "python3",
});
if (res.ok) {
  console.log(res.body.data?.outputs);
}
```

#### MCP Tool Calls

```typescript
// List configured servers
const servers = await client.mcp.listMcpServers();
if (servers.ok) console.log(servers.body.data);

// List tools from a server
const tools = await client.mcp.listMcpTools("browser");
if (tools.ok) console.log(tools.body.data?.tools);

// Execute a tool. serverName, toolName, and the argument record are POSITIONAL.
const shot = await client.mcp.executeMcpTool(
  "browser",
  "screenshot",
  { url: "https://example.com", width: 1920, height: 1080 },
);
if (shot.ok) console.log(shot.body.data);
```

## Next Steps

- **[Terminal Examples](/examples/terminal)** - Start with terminal integration
- **[Browser Examples](/examples/browser)** - Explore browser automation
- **[Agent Integration](/examples/agent)** - Build AI-powered workflows

For additional support:
- Check the [API documentation](/api/) for detailed specifications
- Explore the [GitHub repository](https://github.com/ProwlrBot/CyberBox) for latest updates
