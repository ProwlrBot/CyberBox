# ScopeDeck threat model

The main failure modes are:

- poisoned source data
- stale scope
- false ownership inference
- overconfident ranking
- accidental export of uncertain scope
- UI trust drift

Current controls:

- source provenance
- explicit authority labels
- source snapshots
- confidence separation
- policy warnings
- loopback binding and same-origin mutation checks
- HTTPS-only remote imports with private-address and size checks

ScopeDeck cannot prove that a source is correct or current. It preserves the
source and confidence so the operator can make that decision.
