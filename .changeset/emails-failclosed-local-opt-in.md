---
"@hasna/emails": major
---

Close the last local-store door in the client seam. A database path
(`HASNA_EMAILS_DB_PATH` / `EMAILS_DB_PATH`) no longer selects SQLite on its own:
the client-side on-box store is reachable only through the standard opt-in
`HASNA_EMAILS_LOCAL=1` (alias `EMAILS_LOCAL=1`), answered from the environment
before any Keychain or credentials-file read and only when the environment
configures no Emails authority or credential — a configured environment outranks
the flag. A path without the opt-in is refused; a database path beside a
configured API remains a two-store contradiction. Invalid local-selector values
are refused rather than treated as truthy. Every refusal is a typed
`StoreConfigurationError` naming keys, never values. Local mode prints
one stderr line, `emails: LOCAL mode — …`, once per process. The `emails` and
`emails-mcp` bins stay hosted-only and refuse both settings up front.

The stale client aliases `EMAILS_SELF_HOSTED_URL` / `EMAILS_SELF_HOSTED_API_KEY`
are retired from the client: they are no longer accepted or resolved as
configuration. A shell that still exports one fails closed with an error naming
the retired key and the canonical
`HASNA_EMAILS_API_URL` / `HASNA_EMAILS_API_KEY` names instead of being silently
ignored. Server-side `self_hosted` vocabulary (the `/v1` control plane under
`src/server/self-hosted/`, generated client types, `EMAILS_SELF_HOSTED_HTTP_*`
transport knobs) is unchanged in this release. The standalone `emails-serve`
backend selection remains separate: `EMAILS_DATABASE_URL` selects PostgreSQL and
an unset value retains the loopback SQLite dashboard.

Long-lived HTTP stores and mail data sources now re-resolve and compare their
authority and credential binding before every request or cache hit. Any drift is
refused before dispatch, preventing a multi-request operation or cached result
from crossing tenant identities; callers rebuild the client to adopt a rotation.
Terminal `/v1` normalization remains exactly-once.
