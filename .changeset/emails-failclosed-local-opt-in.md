---
"@hasna/emails": patch
---

Close the last local-store door in the client seam. A database path
(`HASNA_EMAILS_DB_PATH` / `EMAILS_DB_PATH`) no longer selects SQLite on its own:
the on-box store is reachable only through the standard opt-in
`HASNA_EMAILS_LOCAL=1` (alias `EMAILS_LOCAL=1`), answered from the environment
before any Keychain or credentials-file read and only when the environment
configures no Emails authority or credential — a configured environment outranks
the flag. A path without the opt-in, or an opt-in beside a configured API, is a
typed `StoreConfigurationError` naming the keys (never a value). Local mode prints
one stderr line, `emails: LOCAL mode — …`, once per process. The `emails` and
`emails-mcp` bins stay hosted-only and refuse both settings up front.

The one-release aliases `EMAILS_SELF_HOSTED_URL` / `EMAILS_SELF_HOSTED_API_KEY`
are retired from the client: they are no longer read anywhere, no refusal message
advertises them, and a shell that still exports one is refused with the canonical
`HASNA_EMAILS_API_URL` / `HASNA_EMAILS_API_KEY` names instead of being silently
ignored. Server-side `self_hosted` vocabulary (the `/v1` control plane under
`src/server/self-hosted/`, generated client types, `EMAILS_SELF_HOSTED_HTTP_*`
transport knobs) is unchanged in this release.
