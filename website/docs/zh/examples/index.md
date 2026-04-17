# 示例

本节提供使用 CyberBox 在实际场景中的实用集成指南。下方所有片段均与当前
CyberBox SDK 的 API（PyPI 上的 `agent-sandbox`、npm 上的
`@agent-infra/sandbox`）保持一致。若发现漂移，SDK 源码为权威来源，参见
[`sdk/python/README.md`](https://github.com/ProwlrBot/CyberBox/blob/main/sdk/python/README.md)
与 [`sdk/js/README.md`](https://github.com/ProwlrBot/CyberBox/blob/main/sdk/js/README.md)。

## 快速示例

### 终端集成
了解如何将 WebSocket 终端集成到您的应用中：
- [基本终端客户端](/examples/terminal) - 简单的终端集成
- [高级终端功能](/examples/terminal#advanced-features) - 会话管理和重连

### 浏览器自动化
探索浏览器自动化能力：
- [Browser Use 集成](/examples/browser) - Python 浏览器自动化
- [Playwright 集成](/examples/browser#playwright) - 高级浏览器控制
- [Web 抓取示例](/examples/browser#scraping) - 数据提取模式

### Agent 集成
使用 CyberBox 构建 AI Agent：
- [基本 Agent 设置](/examples/agent) - 将 Agent 连接到沙盒
- [MCP 集成](/examples/agent#mcp) - 使用模型上下文协议
- [多工具工作流](/examples/agent#workflows) - 组合多个 API

## 集成模式

### Docker Compose 设置
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

### Kubernetes 部署
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

## SDK 示例

### Python SDK

安装 Python SDK：

```bash
pip install agent-sandbox
# 或者使用 uv：
uv add agent-sandbox
```

#### 基本配置

SDK 提供 `Sandbox`（同步）和 `AsyncSandbox`（异步）两种客户端，均接受
`base_url`、`timeout`、`headers`、`follow_redirects` 与 `httpx_client`
参数。没有 `retries` / `retry_delay` 参数 —— 若需自定义传输行为，请传入
预配置的 `httpx.Client` / `httpx.AsyncClient`。

```python
from agent_sandbox import Sandbox

client = Sandbox(
    base_url="http://localhost:8080",  # CyberBox URL
    timeout=30.0,                      # 秒
)
```

每个资源方法都返回一个 Pydantic 模型（`Response*`），包含四个字段：
`success`、`message`、`data`、`hint`。类型化的业务数据在 `.data` 上。

#### Shell 操作

通过 `client.shell.exec_command` 执行命令并管理 shell 会话。会话通过
`id`（可选 —— 省略时会自动创建一个）标识；后续调用传入相同的 `id`
即可复用状态。

```python
# 单次执行命令
result = client.shell.exec_command(command="ls -la")
if result.success and result.data:
    print("输出：", result.data.output)
    print("退出码：", result.data.exit_code)

# 固定 session id 以在多次调用间保留 cwd / env
session_id = "my-session-1"
client.shell.exec_command(
    command="cd /workspace && pwd",
    id=session_id,
)
client.shell.exec_command(command="ls", id=session_id)

# 异步执行长时间运行的命令
client.shell.exec_command(
    command="python long_script.py",
    async_mode=True,
    id=session_id,
)

# 读取缓冲输出
view = client.shell.view(id=session_id)
if view.data:
    print(view.data.output)
```

异步版本 —— 将 `Sandbox` 替换为 `AsyncSandbox`，并 `await` 每次调用：

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

#### 文件操作

文件资源使用 `read_file` / `write_file` / `list_path` / `find_files` /
`search_in_file` / `grep_files` 等方法。不存在 `file.read` 或 `file.list`
这类别名。

```python
# 写入文件
client.file.write_file(
    file="/tmp/example.py",
    content=(
        "import numpy as np\n"
        "print(np.arange(10))\n"
    ),
)

# 读取文件
read = client.file.read_file(file="/tmp/example.py")
if read.data:
    print(read.data.content)

# 递归列出目录
listing = client.file.list_path(path="/tmp", recursive=True)
if listing.data:
    for entry in listing.data.files:
        print(f"{entry.name}: {entry.size} 字节")

# 在单个文件中进行正则搜索
search = client.file.search_in_file(
    file="/tmp/example.py",
    regex=r"import \w+",
)
if search.data:
    for match in search.data.matches:
        print(f"第 {match.line} 行：{match.content}")

# 按 glob 模式在目录下查找文件
found = client.file.find_files(path="/tmp", glob="*.py")

# 在多个文件中 grep
grepped = client.file.grep_files(path="/tmp", pattern="TODO")
```

#### 代码执行

Jupyter（持久化内核会话，有状态）：

```python
jupyter_result = client.jupyter.execute_code(
    code=(
        "import pandas as pd\n"
        "df = pd.DataFrame({'x': range(5), 'y': range(5, 10)})\n"
        "print(df)\n"
    ),
    timeout=60,
    session_id="data-analysis-session",   # 跨调用保持内核状态
)

if jupyter_result.data:
    for output in jupyter_result.data.outputs:
        if output.output_type == "stream":
            print(output.text)
        elif output.output_type == "execute_result":
            print(output.data.get("text/plain", ""))
```

Node.js（有状态）：

```python
nodejs_result = client.nodejs.execute_code(
    code="console.log(process.version)",
    timeout=30,
)
if nodejs_result.data:
    print(nodejs_result.data.stdout)
```

通过 `client.code` 一次性执行多语言代码（无状态）：

```python
py = client.code.execute_code(language="python", code="print(2 + 2)")
if py.data:
    print(py.data)
```

#### MCP 集成

MCP 方法使用 `mcp_` 前缀命名，参数负载通过单个 `request` 字典传递
（而非 `arguments=`）：

```python
# 列出已配置的 MCP 服务器
servers = client.mcp.list_mcp_servers()
print("MCP 服务器：", servers.data)

# 列出指定服务器的工具
tools = client.mcp.list_mcp_tools(server_name="browser")
if tools.data:
    for tool in tools.data.tools:
        print(tool.name, "-", tool.description)

# 执行工具 —— server_name / tool_name 为位置参数，
# 参数负载通过 `request=` 传入
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

#### 错误处理

资源方法返回 `Response*` 模型 —— 请检查 `.success` 与 `.data` 而不是
依赖异常。只有底层 `httpx` 传输错误（超时、DNS、连接拒绝等）会抛出
异常。

```python
try:
    result = client.shell.exec_command(command="potentially-failing-command")
    if not result.success:
        print("命令失败：", result.message)
    elif result.data and result.data.exit_code != 0:
        print("非零退出码：", result.data.exit_code)

    # 沙盒健康 / 环境信息
    ctx = client.sandbox.get_context()
    if ctx.data:
        print("系统环境：", ctx.data)
except Exception as e:
    # 传输错误 —— socket / DNS / 超时 等
    print(f"传输错误：{e}")
```

### Node.js SDK

```bash
pnpm add @agent-infra/sandbox
# 或者：npm install @agent-infra/sandbox
```

#### 基本配置

JS 客户端构造函数接受 `environment`（基础 URL），以及可选的
`timeoutInSeconds`、`maxRetries` 与 `headers`。不再有 `baseUrl`、
`timeout`（毫秒）、`retries`、`retryDelay` —— 这些是上游旧版字段名，已
不存在。

```typescript
import { SandboxClient } from "@agent-infra/sandbox";

const client = new SandboxClient({
  environment: process.env.SANDBOX_API_URL ?? "http://localhost:8080",
  timeoutInSeconds: 30,
  maxRetries: 3,
});
```

每个方法返回 `HttpResponsePromise`，解析为 `APIResponse` 判别联合类型。
读取 `res.body` 前请先在 `res.ok` 上做收窄：

```typescript
const res = await client.shell.execCommand({ command: "uname -a" });
if (res.ok) {
  console.log(res.body.data?.output);
} else {
  console.error("API 错误：", res.error);
}
```

#### Shell 执行

```typescript
const res = await client.shell.execCommand({
  command: "ls -la",
});
if (res.ok) {
  console.log("输出：", res.body.data?.output);
  console.log("退出码：", res.body.data?.exit_code);
}

// 通过固定 session id 在多次调用间保持状态。
const sessionId = "my-session-1";
await client.shell.execCommand({ command: "cd /workspace", id: sessionId });
const listing = await client.shell.execCommand({ command: "ls", id: sessionId });
```

#### 文件管理

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

#### Jupyter 代码执行

```typescript
const res = await client.jupyter.executeCode({
  code: "print('你好，Jupyter！')",
  kernelName: "python3",
});
if (res.ok) {
  console.log(res.body.data?.outputs);
}
```

#### MCP 工具调用

```typescript
// 列出已配置的服务器
const servers = await client.mcp.listMcpServers();
if (servers.ok) console.log(servers.body.data);

// 列出服务器的工具
const tools = await client.mcp.listMcpTools("browser");
if (tools.ok) console.log(tools.body.data?.tools);

// 执行工具。serverName、toolName 与参数记录均为位置参数。
const shot = await client.mcp.executeMcpTool(
  "browser",
  "screenshot",
  { url: "https://example.com", width: 1920, height: 1080 },
);
if (shot.ok) console.log(shot.body.data);
```

## 下一步

- **[终端示例](/examples/terminal)** - 从终端集成开始
- **[浏览器示例](/examples/browser)** - 探索浏览器自动化
- **[Agent 集成](/examples/agent)** - 构建 AI 驱动的工作流

如需更多帮助：
- 查看 [API 文档](/api/) 了解详细规范
- 访问 [GitHub 仓库](https://github.com/ProwlrBot/CyberBox) 获取最新更新
