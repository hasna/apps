---
"@hasna/logs": minor
---

Resolve credentials through the `@hasna/contracts` client chain (hasna/apps#1720).

The CLI, the MCP server and the `@hasna/logs/api` SDK no longer read a
credential chain of their own. All three call the one resolver in
`@hasna/contracts` (pinned to the exact released 1.0.2), which reads, fresh on
every request: an explicit `--api-key`/`--profile`, then
`HASNA_LOGS_API_KEY_OVERRIDE` / `HASNA_PROFILE` / `HASNA_LOGS_API_KEY_REF`,
then the macOS Keychain item `hasna.credentials.logs.api-key` (account
`HASNA_STATION`, else `hostname -s`, else `USER`), then
`~/.hasna/logs/config/credentials` (owner-only 0400/0600; `HASNA_HOME` /
`HASNA_CONFIG_HOME` move the root), then `HASNA_LOGS_API_KEY`. The authority
follows the same ladder — `HASNA_LOGS_API_URL`, the Keychain `api-url` item,
the credentials file — and now DEFAULTS to the fleet gateway
`https://api.hasna.com/logs`, so a key alone is a complete configuration. The
unprefixed `LOGS_API_URL` / `LOGS_API_KEY` names survive only as the resolver's
silent alias fallback for one release and NEVER outrank the canonical pair.

What this removes:

- The last app-level store selector (`HASNA_LOGS_STORAGE_MODE` /
  `LOGS_STORAGE_MODE` and the other `*_MODE` spellings): inert everywhere, and
  the vendored storage kit's retired mode variables are gone with the kit
  regeneration.
- The serve's silent SQLite default. `logs-serve` with no
  `HASNA_LOGS_DATABASE_URL` no longer opens the local database on its own:
  it serves the on-box SQLite collector only under the explicit
  `HASNA_LOGS_LOCAL=1` opt-in (printing one `local` line on stderr) and fails
  loud otherwise — the same fail-closed rule as the client surfaces.
- The local-store documentation that implied SQLite is the serve's default
  (breaking, hence `minor`): a local collector run must now be named.

What this adds:

- `@hasna/logs/api` exports `createLogsApiClientFromEnv`, the resolver-backed
  factory for the generated `/v1` client: it throws when no credential
  resolves, refreshes the credential on every request, and pins the
  credential to an EXPLICIT caller-supplied `baseUrl` (hasna/apps#1794) — a
  station's fleet key never rides to a caller-named authority.
- `logs transport` reports the transport decision and its source (an env key
  NAME, a Keychain item reference, a credential file PATH, the fleet gateway
  default, or the explicit local opt-in) — never a value.
- The published `.d.ts` no longer imports `@hasna/contracts` at all: the
  crossing client types are spelled locally and pinned identical by tests
  (hasna/apps#1782), so the package's build-time devDependency never leaks
  into a consumer's type-check.
- The vendored storage kit regenerates to 1.0.2 (server backend resolution is
  now PostgreSQL-fail-closed, matching the fleet doctrine) and
  `hasna.contract.json` moves `kitVersion` and the client env keys to the
  canonical `HASNA_LOGS_*` names.

Behaviour worth knowing:

- Hosted mode with no credential still fails closed — non-zero exit, no
  SQLite opened, no local-fallback event — and the message names every tier
  it consulted plus the gateway default.
- Local mode (`HASNA_LOGS_LOCAL=1`, alias `LOGS_LOCAL=1`) is honoured only
  when the environment configures no authority and no credential, and every
  local run prints one line on stderr saying it is local.
- The `@hasna/logs-sdk` telemetry package stays zero-dependency by design: it
  pushes to an operator-named collector and reads no environment of its own;
  the canonical names to feed its options are documented in its README.