---
"@hasna/messages": minor
---

`messages status` and the uniform `API:` authority line (hasna/apps#1588,
hasna/apps#1601).

- New `messages status` command prints `API: https://api.hasna.com/messages/v1`
  — the resolved `/v1` authority, never a bare origin and never the raw
  configured base — plus the transport and whether an API key is present.
  `--json` reports the same as `app`, `version`, `transport`, `api_url`,
  `api_base` and `api_key_present`. It constructs no store and opens no
  database, and exits non-zero when neither `HASNA_MESSAGES_API_URL` nor
  `HASNA_MESSAGES_LOCAL=1` is configured.
- `messages whoami` output carries `api_url` and `transport` alongside the
  identity record.
- New `resolveMessagesApiBase` on the `./sdk` export, plus `MessagesClient.apiUrl`:
  the client keeps the configured path prefix (`https://api.hasna.com/messages`
  → `https://api.hasna.com/messages/v1/agents`), does not double a base that
  already ends in `/v1`, and refuses a base carrying userinfo, a query or a
  fragment instead of building a malformed request URL.
