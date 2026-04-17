// Minimal JS/TS quickstart for the CyberSandbox HTTP API.
// Requires: docker run --rm -p 8080:8080 ghcr.io/prowlrbot/cybersandbox:latest

import { SandboxClient } from '@agent-infra/sandbox';

async function main() {
  const client = new SandboxClient({
    environment: process.env.SANDBOX_BASE_URL || 'http://localhost:8080',
  });

  const ctx = await client.sandbox.getContext();
  console.log('sandbox context:', ctx.body);

  const shell = await client.shell.execCommand({
    command: 'echo "hello from cybersandbox"',
  });
  console.log('shell stdout:', shell.body);

  const py = await client.code.executeCode({
    language: 'python',
    code: 'print(2 + 2)',
  });
  console.log('python output:', py.body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
