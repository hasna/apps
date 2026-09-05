---
"@hasna/secrets": minor
---

Resolve the client credential and API base URL through the `@hasna/contracts`
resolver (hasna/apps#1720, #1668, #1690).

The package's vendored copy of the contracts client (`src/store/contracts-client/`,
~750 lines pinned at the v0.5.0 shape) is deleted and replaced by the published
`@hasna/contracts` client seam. The CLI, the MCP server and the SDK now share the fleet
credential chain, resolved fresh on every call: an explicit argument, then
`HASNA_SECRETS_API_KEY_OVERRIDE` / `HASNA_PROFILE` / `HASNA_SECRETS_API_KEY_REF`,
then the macOS Keychain item `hasna.credentials.secrets.api-key` (account
`HASNA_STATION`, else the short hostname, else `$USER`), then
`~/.hasna/secrets/config/credentials` (0400/0600, `HASNA_HOME` /
`HASNA_CONFIG_HOME` overrides, XDG never), then `HASNA_SECRETS_API_KEY`. The base
URL follows `HASNA_SECRETS_API_URL`, the Keychain `api-url` item and the
credentials file, and otherwise defaults to the fleet gateway
`https://api.hasna.com/secrets`, so a key alone is enough to reach the fleet.

Behaviour changes:

- The `@hasna/contracts` pin moves from `^0.14.0` to an exact `1.0.0`, not
  `1.0.1`: `apps/contracts` is itself at 1.0.1 in this workspace, so a `1.0.1`
  spec makes bun link the workspace member, and the resulting
  `secrets -> contracts -> peer @hasna/secrets` cycle makes
  `bun install --frozen-lockfile` fail at the repo root (reproducible on bun
  1.3.14; a `1.0.0` spec, which does not admit 1.0.1, resolves from the registry
  and is stable). `dist/client/transport.js`, `dist/client/storage.js` and
  `dist/client/credentials.d.ts` are byte-identical between 1.0.0 and 1.0.1, so
  no resolver behaviour differs. The pin moves to 1.0.1 as soon as
  `@hasna/contracts` publishes past it, or the `@hasna/secrets` peer edge that
  closes the cycle is dropped.
- A station whose key lives only in the Keychain or in
  `~/.hasna/secrets/config/credentials` now works with no environment at all;
  previously it failed closed.
- The SDK's `createSecretsClientFromEnv` no longer reads `SECRETS_API_URL` /
  `SECRETS_API_KEY` ahead of the canonical `HASNA_SECRETS_*` names — that
  shadowing is gone. Both remain accepted as a silent alias inside the shared
  resolver for one release. `SecretsClientOptions.apiKey` also accepts a
  credential provider, so a long-lived client picks up a rotation.
- Retired `*_MODE` / `*_STORAGE_MODE` variables are now inert rather than a hard
  error: the transport is decided by the credential and the authority alone.
- A local run (`HASNA_SECRETS_LOCAL_VAULT=1`) prints one line on stderr saying it
  is local, and yields to a resolved credential so an opted-in station that holds
  a hosted key stays hosted. Hosted mode with no credential still fails closed
  with a non-zero exit and no SQLite file opened.
