# OpenShell-backed browser agents

CyberBox can place Claude Code, Hermes, Codex, or another terminal agent inside
NVIDIA OpenShell while keeping browser policy and authentication on the trusted
host.

```text
OpenShell sandbox
  └─ short-lived role lease
       └─ CyberBox broker
            ├─ scope, pause, and approval checks
            ├─ activity and evidence records
            └─ isolated attacker or victim browser
```

OpenShell is optional. CyberBox uses it as an outer process, filesystem, and
network boundary; it does not replace the Browser Hunt broker. The agent still
does not receive browser API keys, saved browser state, Docker access, or raw
CDP/MCP endpoints.

## Start Browser Hunt

```bash
./bin/cyberbox browser-hunt start
./bin/cyberbox browser init --mode guided --scope '*.example.com'
```

The Browser Hunt Compose project starts the broker on loopback port `17890`.
There is no need to start a second broker process.

Copy [browser-agent-policy.yaml](../../openshell/browser-agent-policy.yaml) and
replace `<DOCKER_HOST_IP>` with the one host address visible from the
OpenShell sandbox. The template only permits these broker paths:

- `GET /health`;
- `GET /v1/contract`;
- `POST /v1/action`.

It does not grant direct access to targets, browsers, Docker, the filesystem, or
model-provider APIs. Attach model-provider policy separately.

## Give the sandbox a role

Acquire the lease on the trusted host:

```bash
./bin/cyberbox browser lease acquire \
  --role attacker \
  --agent hermes \
  --ttl 900
```

Inject only the returned lease into the OpenShell workload. Do not mount
`.cyberbox/browser-hunt` or copy either browser key into the sandbox.

The agent calls the broker with that lease:

```bash
curl --fail-with-body http://host.docker.internal:17890/v1/action \
  -H "Authorization: Bearer $CYBERBOX_BROWSER_LEASE" \
  -H 'Content-Type: application/json' \
  -d '{"role":"attacker","action":"text"}'
```

When policy requires approval, the broker returns HTTP 409 and an approval ID.
Approve the exact action in the CyberBox UI or on the trusted host, then retry
with that ID.

## What remains manual

CyberBox does not install OpenShell or change its gateway, provider, or host
policy. Those operations affect host security and credentials, so the operator
must perform and review them. The supplied policy is a starting template; test
it against the installed OpenShell version before relying on it for an
assessment.
