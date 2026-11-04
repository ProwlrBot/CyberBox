# ScopeDeck provider SDK

Source adapters turn a file or HTTPS response into normalized records. The
built-in adapter names are `manual-json`, `manual-csv`, `github-file`,
`arkadiyt/bounty-targets-data`, `osamahamad/payout-targets-data`, and
`kdairatchi/Gov_Scope`.

Required adapter output:

- `source`
- `authority`
- `source_url`
- `source_record_id`
- `first_seen`
- `last_seen`
- `last_confirmed`
- `confidence`
- `parser_version`
- `raw_source_snapshot`

An adapter may also return policy text, scope assets, signals, and changes.
ScopeDeck stores those rows with the program and source IDs assigned during the
sync. Authority is a label from the source; the adapter must not infer an
official label from a domain name or repository owner.
