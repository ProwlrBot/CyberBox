# CyberBox Design System

## Direction

Professional dark desktop tooling: compact, restrained, legible, and operational. Avoid hacker theatrics, glow, decorative charts, oversized cards, and fake success output.

## Status language

Every capability uses text plus color:

- Ready — installed and verified.
- Running — active process/session.
- Degraded — functional with a known limitation.
- Unavailable — provider or platform cannot support it.
- Missing dependency — actionable package/binary gap.
- Requires configuration — credentials/policy/device needed.
- Preview — bounded functional slice.
- Development stub — navigation/schema only.
- Experimental — functional but unstable/high-risk.

## Tokens

- Background `#111214`; surface `#181a1d`; raised `#20242a`.
- Border `#30343a`; primary text `#e8eaed`; muted `#969ca5`.
- Accent `#3291ff`; success `#51c878`; warning `#e6b34a`; danger `#e06666`.
- Radius 3–5px for controls; avoid large floating rounded containers.
- UI text 12–14px; labels 10–11px; monospace for commands, IDs, hashes, and logs.

## Core components

`PanelShell`, `DockTab`, `StatusBadge`, `ScopeBadge`, `ToolBadge`, `RuntimeBadge`, `PermissionBadge`, `HealthIndicator`, `ResourceMeter`, `EmptyState`, `ErrorRecovery`, `CommandPreview`, `JobProgress`, `EvidenceLink`, `FindingCard`, `TimelineEvent`, `SplitPane`, `DataGrid`, `TreeView`, `DiffViewer`, `LogViewer`, `TerminalPanel`, `BrowserPanel`.

## Interaction rules

- Destructive/state-changing actions show scope, target, provider, command/request, affected files, and approval state.
- Keyboard focus is visible; Escape closes transient UI and restores focus.
- Panels suspend expensive work when inactive but preserve state.
- Empty states state why data is absent and provide the next safe action.
- Errors identify failed subsystem, cause, logs, and recovery action.
- No success state is shown from request acceptance alone; verification is required.

## Docking and persistence

Layouts are trees of split nodes and tab groups. Persist schema version, panel instances, selected tab, sizes, and project ID. Reject unknown panel types and migrate old layout versions explicitly.

## Accessibility

Keyboard-operable docking alternatives, screen-reader labels, non-color status text, minimum contrast, reduced motion, resizable text, accessible dialogs, and focus restoration are release gates.
