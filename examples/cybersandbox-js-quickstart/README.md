# cybersandbox-js-quickstart

Minimal JS/TS example that hits the CyberBox HTTP API via the
`@prowlrbot/cybersandbox` client. Calls three endpoints: `sandbox.getContext`,
`shell.execCommand`, and `code.executeCode`.

## Run

```bash
# 1. Start the sandbox
docker run --rm -p 8080:8080 ghcr.io/prowlrbot/cybersandbox:latest

# 2. In this example directory:
pnpm install
pnpm start
```

Override the URL with `SANDBOX_BASE_URL=http://other-host:8080` if needed.
