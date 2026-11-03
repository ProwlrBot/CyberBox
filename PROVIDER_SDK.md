# CyberBox Provider SDK

Providers adapt mature tools and services to stable CyberBox contracts.

## Required interface

```text
metadata() -> identity, version, capabilities, permissions
probe(context) -> honest health/capability state
plan(context, typed_input) -> command/API preview, scope subjects, resources
execute(context, approved_plan) -> cancellable job stream
collect(context, result) -> structured output and artifacts
cleanup(context, execution) -> cleanup result
```

## Rules

- Providers receive structured inputs, never pre-concatenated shell commands.
- `plan` is side-effect free and must enumerate network destinations and files.
- Active providers call ScopeGuard before execution and when targets change.
- Secrets arrive as short-lived handles and are redacted from plans/logs.
- Health probes distinguish missing binary, missing configuration, degraded dependency, and runtime failure.
- Output parsers preserve raw artifacts and emit normalized observations, not confirmed findings.

## Provider families

Runtime, tool, browser, proxy, notebook, mobile device, cloud, container/Kubernetes, malware, forensics, OSINT, vulnerability intelligence, reporting, secrets, and notifications.

## Conformance

Version parsing, missing dependency, timeout, cancellation, malformed output, oversized output, secret redaction, scope denial, artifact hashing, cleanup, and offline-mode tests.
