---
"@hasna/mementos": minor
---

Resolve credentials through the `@hasna/contracts` client chain (hasna/apps#1720).

The CLI, the MCP server and the `./sdk` client no longer carry a credential
chain of their own (the in-package api-mode client and its env-only resolver
are gone). All three call the one resolver in `@hasna/contracts` (bumped to
1.0.2), fresh on every call so a key rotation heals a long-lived shell or MCP
server without a restart. The chain reads: an explicit argument, then
`HASNA_MEMENTOS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
`HASNA_MEMENTOS_API_KEY_REF`, then the macOS Keychain item
`hasna.credentials.mementos.api-key`, then `~/.hasna/mementos/config/credentials`
(owner-only 0400/0600), then `HASNA_MEMENTOS_API_KEY`. The authority follows the
same ladder — `HASNA_MEMENTOS_API_URL`, the Keychain `api-url` item, the
credentials file — and now DEFAULTS to the fleet gateway
`https://api.hasna.com/mementos` once a credential resolves, so a key alone is a
complete configuration.

What this removes:

- The app's own api-mode credential resolution (`API_URL_ENV_KEYS` /
  `API_KEY_ENV_KEYS` env reads in `src/db/api-mode.ts` and the SDK's
  `MEMENTOS_URL`), and with it every reference to the retired locations:
  `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`, `$XDG_CONFIG_HOME`
  and any `~/.mementos/config.json` key store are inputs nowhere. The legacy
  unprefixed `MEMENTOS_API_URL` / `MEMENTOS_API_KEY` spellings survive only as
  the resolver's silent alias fallback for one release.
- The `*_MODE` / `*_STORAGE_MODE` fail-loud ratchet (and the generated
  storage-kit copy of it): the retired storage-mode variables are inert —
  nothing reads them — and the vendored storage kit was regenerated to the
  pinned contracts 1.0.2 (with a documented local deviation keeping the
  sqlite|postgresql server-backend pair this package's contract declares).
- The old half-pair contract "key without URL throws": a credential with no URL
  now resolves to the fleet gateway, while a URL with no resolvable credential
  still fails closed naming every tier consulted.

What this adds:

- FAIL LOUD, everywhere: hosted with no credential anywhere exits non-zero with
  one line naming the Keychain item, the credentials file and the env key; there
  is no SQLite fallback and no `*-local-fallback` event. The on-box SQLite
  store is reachable ONLY through the explicit opt-ins (`HASNA_MEMENTOS_DB_PATH`
  / `MEMENTOS_DB_PATH`, or `HASNA_MEMENTOS_LOCAL=1` with nothing configured),
  and every local run prints one line saying it is local on stderr.
- The SDK attaches a credential only to the authority it resolved with: an
  explicit `baseUrl` without an explicit `apiKey` never picks up the ambient
  fleet key (hasna/apps#1794), and blank-variable normalisation carries the
  Keychain gate across the copy it forces (hasna/apps#1788).
- Hermetic test seams: an injectable `security` runner and fixture
  `HOME`/`HASNA_CONFIG_HOME` cover the Keychain and disk tiers in the suite;
  the `bun test` preload pins the local opt-in and an empty Keychain account so
  a scrubbed test process physically cannot reach the shared store.

The machines registry, `machine_id` on memories, and the server's own
accepted-key auth are unchanged.
