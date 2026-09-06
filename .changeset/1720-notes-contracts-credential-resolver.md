---
"@hasna/notes": minor
---

Resolve credentials and authority through the `@hasna/contracts` client chain
(hasna/apps#1720), and move the client wire dialect to the `/v1` authority root.

The CLI, the MCP server and the `./sdk` client no longer read canonical env
variables by hand. All three call the one resolver in `@hasna/contracts`
(bumped from 0.10.6 to the exact 1.0.2), per call, fresh: an explicit
`apiKey`/`profile` argument, then `HASNA_NOTES_API_KEY_OVERRIDE` /
`HASNA_PROFILE` / `HASNA_NOTES_API_KEY_REF`, then the macOS Keychain item
`hasna.credentials.notes.api-key`, then `~/.hasna/notes/config/credentials`
(owner-only 0400/0600), then `HASNA_NOTES_API_KEY`. The authority follows the
same ladder — `HASNA_NOTES_API_URL`, the Keychain `api-url` item, the
credentials file — and now DEFAULTS to the fleet gateway
`https://api.hasna.com/notes` once a credential resolves, so a key alone is a
complete configuration. Resolving per call is what makes a rotation heal a
long-lived MCP server, shell or agent without restarting it: every request
re-resolves, and the transport refuses to send when the authority or
credential changed since the client was built.

What this removes:

- The app's own credential chain in `client/transport.mjs` (environment
  snapshot + hand-rolled URL/DSN checks): nothing reads `~/.hasna/fleet-env`,
  `~/.hasna/cloud`, `~/.config/hasna` or `$XDG_CONFIG_HOME`, and no client
  surface resolves a key outside `@hasna/contracts`.
- The legacy-env DEPRECATED notice class: `HASNA_NOTES_API_KEY` remains a
  legitimate tier, it simply sits below Keychain and disk.
- The `/api/v1` wire prefix. The client, the server routes, auth, the OpenAPI
  document, the device page and the dialect docs all speak the `/v1`
  authority root (`/v1/notes`, `/v1/export`, `/v1/auth/...`). The
  `personalnotes/v1` wire NAME and the unversioned `/api/auth` login mirror
  are unchanged. Self-hosted servers must move any pinned `/api/v1/*`
  endpoint to `/v1/*`; the server answers `GET /v1` (dialect discovery),
  `/v1/health`, `/ready`, `/version` and `/openapi.json`.

What this adds:

- `notes storage status` (JSON and text) reports `baseUrl`, `apiUrlSource`,
  `apiKeySource` and `apiKeyTier` — WHICH tier supplied the credential
  (never the value).
- The SDK re-exports the resolver seam (`resolveNotesClientTransport`,
  `createNotesHttpStore`, `NotesHttpStoreError`) unchanged in shape, with the
  new report fields.

Behaviour worth knowing about:

- Hosted mode with no credential still fails closed — non-zero exit, no
  SQLite, no local-fallback event — and the message now names the tier and
  file it consulted. There is deliberately NO local mode to opt into.
- A declared-but-blank variable is a refusal, not an absence, and — because
  the resolver is given the live `process.env` AS-IS, never a copy (#1788) —
  a blank `HASNA_NOTES_*` variable can no longer silently switch the ambient
  Keychain tier off.
- An explicit base URL with no explicit API key is refused outright: the
  ambient fleet credential is never attached to an arbitrary authority
  (#1794).
- The transport treats every 3xx as terminal (redirect never followed),
  cancels 401/403 response bodies unread, and surfaces the credential SOURCE
  (never the value) in auth failures. The notes store's error envelope
  (`NotesHttpStoreError` with status/code/details and credential redaction)
  is preserved.
- The server is unchanged in storage/auth semantics; it remains
  PostgreSQL-only with the mandatory server-only `HASNA_NOTES_DATABASE_URL`.