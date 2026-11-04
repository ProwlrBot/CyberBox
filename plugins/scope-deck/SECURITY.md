# ScopeDeck security

ScopeDeck stores source snapshots so every decision can be audited later.

Rules:

- Community-maintained data is never marked as officially in scope.
- Uncertain scope stays uncertain until policy confirmation.
- JSON exports retain the stored scope state and confidence; callers must
  confirm the current program policy before using them as tool input.
- The plugin never launches scans automatically.
- Network fetches are limited to explicit sync actions, HTTPS, public network
  destinations, five redirects, and 32 MiB responses.
- The web UI uses same-origin checks for mutations and binds to loopback unless
  the operator deliberately chooses another address.
- Imported files must be regular files. Parsing does not execute source data.
