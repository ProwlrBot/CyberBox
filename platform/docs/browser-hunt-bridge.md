# Browser Hunt

Browser Hunt gives an authorized assessment two browser identities without
mixing their sessions. The attacker and victim roles have separate browser
profiles, home volumes, Docker networks, and API keys.

This is useful for access-control testing where one user performs an action and
another user should or should not be able to observe it. A normal automation
profile cannot model that boundary reliably because signing in as the second
user replaces the first session.

## Start the browsers

```bash
./bin/cyberbox browser-hunt start
```

The command starts both browsers and the local broker. It prints two loopback
URLs:

- attacker: signed out or signed in as the lower-privileged test account;
- victim: signed in as the second test account covered by the authorization.

Complete passwords, MFA, passkeys, CAPTCHA, and consent screens yourself. Do not
put credentials, recovery codes, cookies, or bearer tokens in an agent prompt.

The browser volumes survive an ordinary stop or restart. Saving an identity
creates a browser-state checkpoint inside that role's volume.

## Use the control room

Start the main workstation and open **Workspace → Browser Hunt**. The page
contains the controls needed for routine work:

- open either live browser for human control;
- pause or resume agent access;
- save and restore each signed-in identity;
- set the broker mode to Guided, Balanced, or Autonomous;
- add an authorized host or wildcard to scope;
- review and approve exact pending actions;
- choose evidence redaction;
- run one Claude or Ollama planning step;
- inspect the recent broker activity.

The page talks to the broker through the authenticated control plane. The
operator token and browser API keys are never returned to browser JavaScript.

## Use the terminal

`browser-hunt connect` prints examples for locally installed clients:

```bash
./bin/cyberbox browser-hunt connect
```

Initialize policy explicitly:

```bash
./bin/cyberbox browser init \
  --mode guided \
  --scope '*.example.com' \
  --redaction-mode evidence-only
```

Available redaction modes are:

- `always`: redact captured values from live output and stored evidence;
- `evidence-only`: keep live observations usable while redacting audit and
  evidence records;
- `off`: keep captured test values unchanged.

Passwords, cookies, authorization headers, API keys, broker tokens, and token
digests remain hidden in every mode.

Begin sign-in and save the resulting state:

```bash
./bin/cyberbox browser auth begin --role victim
# Complete sign-in at the printed one-time URL.
./bin/cyberbox browser auth ready \
  --role victim \
  --label victim-test-account
```

Agents use an exclusive, expiring lease:

```bash
export CYBERBOX_BROWSER_LEASE="$(
  ./bin/cyberbox browser lease acquire \
    --role attacker \
    --agent claude-code \
    --ttl 900
)"

./bin/cyberbox browser action navigate \
  --role attacker \
  --url https://app.example.com/login
```

The broker checks the lease, pause state, scope, and approval policy before it
forwards an action. Approvals are tied to the exact role, action, and arguments;
they expire and can be used once.

The existing model wrappers can plan and execute one step through the same
checks:

```bash
./bin/cyberbox browser agent-step \
  --provider claude \
  --role attacker \
  --goal 'Inspect the login form'

./bin/cyberbox browser agent-step \
  --provider ollama \
  --role attacker \
  --goal 'Describe the visible account boundary'
```

Page content is untrusted input. The prompt supplied to either provider labels
browser observations accordingly and asks for one structured action.

## State and logs

Broker state lives in `.cyberbox/browser-hunt` by default. The directory is
gitignored and created with owner-only permissions. It contains role API keys,
the operator key, policy, leases, approvals, and the JSONL activity log.

Do not mount this directory into an agent sandbox. Set
`CYBERBOX_BROWSER_HOME` if it needs to live outside the repository.

```bash
./bin/cyberbox browser-hunt status
./bin/cyberbox browser-hunt logs
./bin/cyberbox browser logs --tail 100 --pretty
```

## Cleanup

```bash
./bin/cyberbox browser-hunt stop
```

`stop` keeps the browser volumes. Deleting those volumes removes the saved
sessions, so confirm they are no longer needed before doing so.

## Boundaries

- Browser and broker ports bind to loopback by default.
- The two roles cannot address one another by Compose service name.
- Agents do not receive raw CDP, browser MCP, Docker, or browser API access.
- The broker checks navigation scope, but the operator is still responsible for
  recording valid authorization and keeping scope current.
- Redaction off is useful for local debugging but can preserve account data in
  evidence and logs.
- Remote use requires an authenticated private connection or TLS proxy; do not
  publish the local ports directly.

For an additional process, filesystem, and network boundary around a terminal
agent, see [OpenShell-backed browser agents](openshell-browser-runtime.md).
