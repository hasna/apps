# @hasna/messages

## 0.3.0

### Minor Changes

- b72102f: Resolve credentials through the `@hasna/contracts` 1.0.2 client chain (hasna/apps#1720).

  The CLI, the MCP server and the `./sdk` client no longer carry a credential
  chain of their own. All three call the one resolver in `@hasna/contracts`
  (pinned exactly to 1.0.2, a BUILD-TIME dependency — `bun build --target bun`
  inlines it, and the published declarations spell every crossing type locally
  so no consumer needs a contracts install, hasna/apps#1782), which reads, per
  call: an explicit `--api-key`/`--profile`, then
  `HASNA_MESSAGES_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
  `HASNA_MESSAGES_API_KEY_REF`, then the macOS Keychain item
  `hasna.credentials.messages.api-key`, then
  `~/.hasna/messages/config/credentials` (owner-only 0400/0600), then
  `HASNA_MESSAGES_API_KEY`. The authority follows the same ladder —
  `HASNA_MESSAGES_API_URL`, the Keychain `api-url` item, the credentials file —
  and now DEFAULTS to the fleet gateway `https://api.hasna.com/messages` once a
  credential resolves, so a key alone is a complete configuration. Resolving per
  call is what makes a key rotation heal a long-lived shell, MCP server or agent
  without restarting it: `MessagesClient` re-resolves the credential on every
  request via a per-request provider, so the next request after a rotation
  carries the new key.

  What this removes (breaking, hence minor):

  - The loose half-pair: `HASNA_MESSAGES_API_URL` present alone used to select
    an unauthenticated http run with the key optional. Hosted mode now REQUIRES
    a resolvable credential — a configured authority with no key anywhere is a
    hard error naming every tier consulted, with non-zero exit, no SQLite and
    no `*-local-fallback` event.
  - The app's own base-URL resolver (`resolveMessagesApiBase` internals) —
    replaced by the shared `@hasna/contracts` normaliser, whose plain-HTTP rule
    restricts non-HTTPS authorities to exact loopback.
  - `MESSAGES_LOCAL_MODE_ENV` and `isLocalModeOptIn` exports (the opt-in spelling
    is now `MESSAGES_LOCAL_OPT_IN_ENV_KEYS` / `isMessagesLocalOptIn`).
  - Every `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`,
    `$XDG_CONFIG_HOME` location: nothing reads them; the disk tier reads exactly
    one file, `~/.hasna/messages/config/credentials`.

  What this adds:

  - `messages status` (and `--json`) now reports `api_url_source`,
    `api_key_source`, `api_key_tier` and `authority_pinned` — WHICH tier supplied
    the credential (never the value) and WHERE the authority came from.
  - Local mode (`HASNA_MESSAGES_LOCAL=1`, alias `MESSAGES_LOCAL=1`) is honoured
    only when the environment configures no authority and no credential, is
    answered BEFORE the resolver runs (so an unhosted run reads neither the
    Keychain nor the credential file), and every local run prints one "local
    mode" line on stderr — an unhosted run is never silent.
  - `./sdk` exports the resolver-backed report
    (`resolveMessagesClientTransport`), the per-request-fresh client factory
    (`createMessagesClient`) and the resolver seam types.

  Behaviour worth knowing about:

  - An explicit `baseUrl` (`--url`, SDK option) pins the authority AND the
    credential (hasna/apps#1794): without an explicit `apiKey` the ambient
    chain is never consulted, so a client pointed at a caller-chosen authority
    attaches no fleet key.
  - The environment is handed to the resolver BY IDENTITY, never as a copy
    (hasna/apps#1788): declared-but-blank variables are normalised without
    copying, and the Keychain tier's ambient gate is carried across any copy as
    `keychain.enabled`, so a blank wrapper variable can no longer silently drop
    a station from its Keychain identity to the next tier.
  - The server-side static-key transition (messages-serve accepting
    `HASNA_MESSAGES_API_KEY` as a single static string for one more release) is
    unchanged; the README now distinguishes that server credential from the
    client's legitimate env tier.

### Patch Changes

- fa9b2e6: Resolver validation polish for hasna/apps#1720. The spawn-based tests
  (`early-args.test.ts`, `cli.test.ts`) are now hermetic against the station's
  macOS Keychain: the fake HOME is applied after the env copy (it used to be
  overwritten by the inherited HOME) and `HASNA_STATION` is pinned to a sentinel
  account, so the MCP and CLI fail-closed tests no longer read the real
  `hasna.credentials.messages.api-key` item on a provisioned Mac. The vendored
  path resolver keeps only the data kind messages uses (no config/state/cache
  kinds, no retired dot-config location), the two data-root tests assert the
  shape for the platform they run on, and `hasna.contract.json` declares
  `authMode: "api-key"` for the CLI and MCP surfaces, which resolve a fleet key
  through the `@hasna/contracts` chain. No runtime credential behaviour changes.

## 0.2.2

### Patch Changes

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/messages` data root (with the `HASNA_MESSAGES_HOME` exact-app override layered on top of the existing `HASNA_MESSAGES_SQLITE_PATH` store override) stays the effective data root until the store has been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. Dependency pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.2.1

### Patch Changes

- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.2.0

### Minor Changes

- 0ca2687: feat: scaffold @hasna/messages v0.1.0 — direct agent-to-agent messaging with threads (task 8c6b7978). Four surfaces (CLI `messages`, MCP `messages-mcp`, HTTP API `messages-serve`, SDK `./sdk`) over one domain implementation in `src/service.ts`; per-recipient delivery state (stored -> delivered -> read), native thread list/expand/unread/close-reopen, first-class agent identity; storage backend SQLite by default or PostgreSQL via `HASNA_MESSAGES_DATABASE_URL` (two-backend contract, no mode enums). messages owns DMs + DM-threads only; channels are conversations' domain.

### Patch Changes

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.1.0 — 2026-08-24

Initial scaffold: direct agent-to-agent messaging with threads.
Four surfaces (CLI, MCP, `-serve` HTTP API, `./sdk` client) over one domain
implementation. SQLite default backend, PostgreSQL via
`HASNA_MESSAGES_DATABASE_URL`. Manifest: `hasna.contract.json`.
