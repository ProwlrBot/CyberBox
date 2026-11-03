# CyberBox Workflow SDK

## Workflow contract

Workflows are versioned YAML/JSON documents. Every node declares typed inputs/outputs, provider, permissions, scope requirement, timeout, retry, cancellation, cleanup, structured logs, and artifacts.

```yaml
apiVersion: cyberbox.dev/v1alpha1
kind: Workflow
metadata: {id: passive-recon, version: 1.0.0}
spec:
  inputs: {target_id: {type: target-ref}}
  budgets: {duration: 30m, requests: 5000}
  nodes:
    - id: scope
      uses: scope.validate/v1
    - id: subdomains
      uses: tool.subfinder/v1
      needs: [scope]
      timeout: 10m
      permissions: [network.connect, evidence.write]
```

## Execution

States: Draft, Blocked, Queued, Starting, Running, Waiting for approval, Completed, Failed, Cancelled, Expired. State transitions are validated server-side and append audit events.

## Safety

Dry run resolves providers, targets, scope, permissions, secrets, budgets, and commands without execution. Redirects and dynamically produced targets are rechecked. Approval nodes bind to exact inputs and scope version.

## Conformance

Schema validation, DAG cycle detection, type checking, permission aggregation, budget enforcement, cancellation, retry idempotency, cleanup, resume, and artifact provenance tests are mandatory.
