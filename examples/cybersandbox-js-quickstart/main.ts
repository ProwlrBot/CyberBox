// Minimal JS/TS quickstart for the CyberBox HTTP API.
// Requires: docker run --rm -p 8080:8080 ghcr.io/prowlrbot/cybersandbox:latest

import { SandboxClient } from '@prowlrbot/cybersandbox';

async function main() {
  const client = new SandboxClient({
    environment: process.env.SANDBOX_BASE_URL || 'http://localhost:8080',
  });

  const ctx = await client.sandbox.getContext();
  if (!ctx.ok) {
    throw new Error(`sandbox.getContext failed: ${JSON.stringify(ctx.error)}`);
  }
  console.log('sandbox context:', ctx.body);

  const shell = await client.shell.execCommand({
    command: 'echo "hello from cybersandbox"',
  });
  if (!shell.ok) {
    throw new Error(`shell.execCommand failed: ${JSON.stringify(shell.error)}`);
  }
  console.log('shell output:', shell.body.data?.output);

  const py = await client.code.executeCode({
    language: 'python',
    code: 'print(2 + 2)',
  });
  if (!py.ok) {
    throw new Error(`code.executeCode failed: ${JSON.stringify(py.error)}`);
  }
  console.log('python output:', py.body.data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
