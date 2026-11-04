# ScopeDeck workflow handoff

ScopeDeck does not start scans or create CyberBox projects. Its CLI writes JSON
to standard output, which makes an explicit handoff straightforward:

```bash
scopedeck draw --mode beginner-entry > selected-program.json
scopedeck export scope --program <id> > approved-scope-review.json
```

Treat both files as research input, not authorization. A workflow should check
the current program policy and have an operator approve the final scope before
using either payload to configure another tool.
