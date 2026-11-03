# CyberBox Plugin SDK

## Package contract

```yaml
apiVersion: cyberbox.dev/v1alpha1
kind: Plugin
metadata:
  id: publisher.plugin
  version: 1.2.0
  publisher: publisher-id
spec:
  type: workflow-node
  entrypoint: plugin.wasm
  compatibility: ">=1.0.0 <2.0.0"
  permissions: [project.read, evidence.write]
  dependencies: []
  ui: {}
integrity:
  sha256: "..."
  signature: "..."
```

## Permission model

Deny by default. Supported namespaces include `project`, `terminal`, `browser`, `traffic`, `filesystem`, `network`, `device`, `cloud`, `workflow`, `finding`, `evidence`, and `secret`. Permissions are project-scoped, user-approved, auditable, and revocable.

## Lifecycle

Discovered → Downloaded → Quarantined → Verified → Permission review → Installed → Enabled. Incompatible, revoked, disabled, and uninstalled are explicit states. Download never implies execution.

## Runtime

Prefer WASM with explicit host calls for portable parsers, panels, and workflow nodes. Native tools run as isolated provider subprocesses with structured arguments, timeouts, resource limits, restricted filesystem/network, and captured artifacts.

## Conformance

Plugins must pass manifest schema, signature/hash, path/archive safety, permission denial, resource limit, deterministic cleanup, compatibility, and uninstall tests.
