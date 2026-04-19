# @prowlrbot/cybersandbox

Node.js/TypeScript SDK for the CyberSandbox HTTP API — shipped as part of
[ProwlrBot/CyberBox](https://github.com/ProwlrBot/CyberBox). It talks to the
hardened sandbox container at `ghcr.io/prowlrbot/cybersandbox:latest`, exposing
shell, file, browser, code-execution, Jupyter, Node.js, MCP, and provider
APIs.

The package is a Fern-generated client plus custom cloud provider adapters.
It is API-compatible with upstream `@agent-infra/sandbox`; the published
artifact is maintained out of the CyberBox monorepo.

## Installation

```bash
pnpm add @prowlrbot/cybersandbox
# or: npm install @prowlrbot/cybersandbox
# or: yarn add @prowlrbot/cybersandbox
```

Start the sandbox container the SDK talks to:

```bash
docker pull ghcr.io/prowlrbot/cybersandbox:latest
docker run --rm -p 8080:8080 ghcr.io/prowlrbot/cybersandbox:latest
```

## Response shape

Every resource method returns an `HttpResponsePromise` that resolves to an
`APIResponse` discriminated union:

```typescript
// Success branch:
{ ok: true, body: <parsed response>, rawResponse }
// Failure branch:
{ ok: false, error: <typed error>, rawResponse }
```

Always narrow on `res.ok` before reading `res.body`.

## 30-second Quick Start

```typescript
import { SandboxClient } from '@prowlrbot/cybersandbox';

const client = new SandboxClient({
  environment: process.env.SANDBOX_API_URL || 'http://localhost:8080',
});

// Run a shell command inside the sandbox.
const shell = await client.shell.execCommand({
  command: 'echo "hello from cybersandbox"',
});
if (shell.ok) {
  console.log(shell.body.data?.output);
}

// Execute Python.
const py = await client.code.executeCode({
  language: 'python',
  code: 'print(2 + 2)',
});
if (py.ok) {
  console.log(py.body.data);
}
```

### File read

```typescript
const result = await client.file.readFile({
  file: '/workspace/README.md',
});

if (result.ok) {
  console.log(result.body.data?.content);
}
```

### Using Cloud Providers

The SDK includes provider implementations for managing sandboxes on different cloud platforms.

#### Volcengine Provider

```typescript
import { providers } from '@prowlrbot/cybersandbox';

// Initialize Volcengine provider
const volcengineProvider = new providers.VolcengineProvider({
  accessKey: process.env.VOLCENGINE_ACCESS_KEY,
  secretKey: process.env.VOLCENGINE_SECRET_KEY,
  region: 'cn-beijing', // Optional, defaults to 'cn-beijing'
});

// Create a sandbox
const sandboxId = await volcengineProvider.createSandbox(
  'your-function-id',
  30 // timeout in minutes
);
console.log('Created sandbox:', sandboxId);

// Get sandbox details with APIG domains
const sandbox = await volcengineProvider.getSandbox(
  'your-function-id',
  sandboxId
);
console.log('Sandbox domains:', sandbox.domains);

// List all sandboxes for a function
const sandboxes = await volcengineProvider.listSandboxes('your-function-id');
console.log('Total sandboxes:', sandboxes.length);

// Delete a sandbox
await volcengineProvider.deleteSandbox('your-function-id', sandboxId);
console.log('Sandbox deleted');
```

#### Application Management

```typescript
// Create an application
const appId = await volcengineProvider.createApplication(
  'my-app',
  'my-gateway'
);

// Check application readiness
const [isReady, functionId] = await volcengineProvider.getApplicationReadiness(appId);
if (isReady) {
  console.log('Application is ready, function ID:', functionId);
}

// Get APIG domains for a function
const domains = await volcengineProvider.getApigDomains('your-function-id');
console.log('Available domains:', domains);
```

## Features

### Sandbox API Client

- **File Operations**: Read, write, search, and manage files
- **Shell Execution**: Execute shell commands and manage sessions
- **Browser Automation**: Control browser actions and retrieve information
- **Code Execution**: Execute code in various languages (Python, Node.js, Jupyter)
- **MCP Integration**: Execute MCP (Model Context Protocol) tools

### Cloud Providers

#### Volcengine Provider

- Sandbox lifecycle management (create, delete, get, list)
- Application deployment and monitoring
- APIG (API Gateway) domain management
- Automatic request signing with HMAC-SHA256
- Support for temporary credentials

#### Extensible Provider System

Create custom providers by extending the `BaseProvider` class:

```typescript
import { providers } from '@prowlrbot/cybersandbox';

class MyCustomProvider extends providers.BaseProvider {
  async createSandbox(functionId: string, ...kwargs: any[]): Promise<any> {
    // Your implementation
  }

  async deleteSandbox(functionId: string, sandboxId: string, ...kwargs: any[]): Promise<any> {
    // Your implementation
  }

  async getSandbox(functionId: string, sandboxId: string, ...kwargs: any[]): Promise<any> {
    // Your implementation
  }

  async listSandboxes(functionId: string, ...kwargs: any[]): Promise<any> {
    // Your implementation
  }
}
```

## API Reference

### SandboxClient

The main client for interacting with the Sandbox API.

```typescript
const client = new SandboxClient({
  environment: string,              // API base URL (e.g. http://localhost:8080)
  timeoutInSeconds?: number,        // Per-request timeout in seconds
  maxRetries?: number,              // Retry count
  headers?: Record<string, string>, // Custom headers
});
```

#### Available Modules

Every module exposes namespace methods; each call returns an
`HttpResponsePromise<APIResponse<…>>` (see "Response shape" above).

- `client.sandbox` — environment info (`getContext`, `getPythonPackages`, `getNodejsPackages`)
- `client.shell` / `client.bash` — shell sessions (`execCommand`, `view`, `waitForProcess`,
  `writeToProcess`, `killProcess`, `createSession`, `listSessions`, `cleanupSession`,
  `cleanupAllSessions`, `getTerminalUrl`, `updateSession`)
- `client.file` — `readFile`, `writeFile`, `listPath`, `findFiles`, `globFiles`,
  `grepFiles`, `searchInFile`, `replaceInFile`, `strReplaceEditor`, `uploadFile`,
  `downloadFile`
- `client.code` — `executeCode`, `getInfo`
- `client.jupyter` — `executeCode`, `getInfo`, session controls
- `client.nodejs` — `executeCode`, `getInfo`, session controls
- `client.browser`, `client.browserPage`, `client.browserTabs`,
  `client.browserCookies`, `client.browserState`, `client.browserNetwork`,
  `client.browserCaptcha` — browser automation surfaces
- `client.mcp` — MCP tool calls
- `client.skills` — sandbox-registered skills
- `client.proxy` — outbound proxy routing
- `client.auth` / `client.util` — helpers

### Providers

#### BaseProvider (Abstract)

Base class for all cloud provider implementations.

**Methods:**
- `createSandbox(functionId: string, ...kwargs: any[]): Promise<any>`
- `deleteSandbox(functionId: string, sandboxId: string, ...kwargs: any[]): Promise<any>`
- `getSandbox(functionId: string, sandboxId: string, ...kwargs: any[]): Promise<any>`
- `listSandboxes(functionId: string, ...kwargs: any[]): Promise<any>`

#### VolcengineProvider

Volcengine VEFAAS implementation.

**Constructor Options:**
```typescript
{
  accessKey: string;              // Volcengine access key ID
  secretKey: string;              // Volcengine secret access key
  region?: string;                // Region (default: 'cn-beijing')
  clientSideValidation?: boolean; // Enable validation (default: true)
}
```

**Additional Methods:**
- `createApplication(name: string, gatewayName: string): Promise<string | null>`
- `getApplicationReadiness(id: string): Promise<[boolean, string | null]>`
- `getApigDomains(functionId: string): Promise<DomainInfo[]>`

## Environment Variables

Configure Volcengine credentials using environment variables:

```bash
# Volcengine credentials (option 1)
VOLCENGINE_ACCESS_KEY=your-access-key
VOLCENGINE_SECRET_KEY=your-secret-key

# Volcengine credentials (option 2)
VOLC_ACCESSKEY=your-access-key
VOLC_SECRETKEY=your-secret-key
```

## TypeScript Support

This package is written in TypeScript and includes full type definitions. TypeScript 5.0+ is recommended.

```typescript
import type {
  SandboxApi,
  BaseClientOptions,
  BaseRequestOptions,
} from '@prowlrbot/cybersandbox';
```

## Error handling

Resource methods never throw on an HTTP error status — they resolve to the
`{ ok: false, error, rawResponse }` branch. Network-level failures (DNS,
timeout, aborted request) reject the promise, so wrap the call in
`try/catch` if you need to distinguish both.

```typescript
try {
  const res = await client.file.readFile({ file: '/nonexistent' });
  if (!res.ok) {
    // Typed error; `res.error.statusCode` === 422 for UnprocessableEntity.
    console.error('API error:', res.error);
    return;
  }
  console.log(res.body.data?.content);
} catch (err) {
  // Transport error (timeout, aborted, network).
  console.error('Request failed:', err);
}
```

## Development

### Project Structure

```
sdk/js/
├── src/              # TypeScript source code
│   ├── api/          # Generated API modules
│   ├── core/         # Core utilities
│   ├── providers/    # Cloud provider implementations (custom code)
│   │   ├── base.ts       # Base provider interface
│   │   ├── volcengine.ts # Volcengine implementation
│   │   ├── sign.ts       # Request signing utilities
│   │   └── README.md     # Provider documentation
│   ├── BaseClient.ts # Base client implementation
│   ├── Client.ts     # Main API client
│   └── index.ts      # Package entry point
├── dist/             # Compiled JavaScript output (generated by build)
├── package.json      # Package configuration
└── tsconfig.json     # TypeScript configuration
```

### Building

```bash
npm run build
```

This will:
1. Compile TypeScript files from `src/` to JavaScript in `dist/`
2. Generate `.d.ts` type definition files
3. Generate source maps for debugging

### Testing

```bash
npm test

# With coverage
npm run test:coverage

# With UI
npm run test:ui
```

### Development Mode

```bash
npm run dev  # Watch mode with auto-rebuild
```

### Generating SDK

The base SDK code is generated using [Fern](https://buildwithfern.com/):

```bash
cd sdk/fern
fern generate --group nodejs-sdk --local
```

This generates TypeScript code from the OpenAPI specification into `src/`.
Custom providers in `src/providers/` are preserved via `.fernignore`.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Adding Custom Providers

See [providers/README.md](./providers/README.md) for detailed information on implementing custom cloud providers.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

## Links

- [CyberBox monorepo](https://github.com/ProwlrBot/CyberBox)
- [CyberSandbox image](https://github.com/ProwlrBot/CyberBox/pkgs/container/cybersandbox)
- [Issues](https://github.com/ProwlrBot/CyberBox/issues)
- [Volcengine Documentation](https://www.volcengine.com/docs/)

## Support

For questions and support, please open an issue on GitHub.

---

**Node.js**: >=18.0.0
**TypeScript**: >=5.0.0
