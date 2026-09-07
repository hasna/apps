---
"@hasna/calendar": minor
---

Resolve credentials and authority through the `@hasna/contracts` client chain (hasna/apps#1720).

The CLI, the MCP server, `getStore()` and the `./sdk` client no longer carry a credential
chain of their own. All of them call the one resolver in `@hasna/contracts` 1.0.2 (a
build-time devDependency, inlined into every `bun build --target bun` bundle; the
published `.d.ts` spells the crossing credential types locally, hasna/apps#1782), which
reads, fresh on every call: an explicit `apiKey` / `profile` argument, then
`HASNA_CALENDAR_API_KEY_OVERRIDE` / `HASNA_PROFILE` / `HASNA_CALENDAR_API_KEY_REF`, then
the macOS Keychain item `hasna.credentials.calendar.api-key` (account `HASNA_STATION`,
else hostname, else `USER`), then `~/.hasna/calendar/config/credentials` (owner-only
0400/0600), then `HASNA_CALENDAR_API_KEY`. The authority follows the same ladder —
`HASNA_CALENDAR_API_URL`, the Keychain `api-url` item, the credentials file — and now
DEFAULTS to the fleet gateway `https://api.hasna.com/calendar` once a credential
resolves, so a key alone is a complete configuration and URLs never need configuring on
a station. The unprefixed `CALENDAR_*` spellings remain as the resolver's documented
silent alias; a declared-but-blank variable still means "unset" at the Calendar seam
(`calendarResolverInputs`), and the Keychain tier's ambient gate travels with the
normalised copy as `keychain.enabled` rather than being silently lost (hasna/apps#1788).

What this removes:

- The app's own env-selection chain in `src/store/http-storage.ts` (the
  `HASNA_CALENDAR_*` / `CALENDAR_*` pair was already canonical; the resolver now owns
  the tiers above env). Nothing reads the retired locations — `~/.hasna/fleet-env`, the
  old `~/.hasna` cloud folder, `~/.config/hasna`, `$XDG_CONFIG_HOME` — and the retired
  `*_MODE` / `*_STORAGE_MODE` / `*_BACKEND` / `*_LOCAL` / `*_SELF_HOSTED` / `*_CLOUD`
  placement selectors are refused as a fail-loud ratchet instead of being inputs.
- The `{ env }` constructor branch of the generated `CalendarV1Client`: the SDK entry
  point (`createCalendarClient`) owns resolution now, and an explicit `baseUrl` is a
  deliberate pin — with an explicit `apiKey` it is the whole configuration; without one
  the SDK refuses rather than attaching a credential that resolved for a different
  authority (hasna/apps#1794).

What this adds:

- The fleet gateway default: `HASNA_CALENDAR_API_KEY` alone (or a Keychain / disk
  credential) now resolves `https://api.hasna.com/calendar/v1` instead of being refused
  as a half-configured pair.
- `resolveStorageClient` / `resolveClientTransport` reports carry `apiKeyTier`, and the
  source fields name the TRUE tier (env key NAME, Keychain item reference, or file
  PATH) — never a value.
- Per-request freshness on `/v1` through the chain: a long-lived MCP server or SDK
  client re-resolves the credential on every request, so a rotation heals without a
  restart (the authority stays fixed for the life of a client).
- The explicit legacy `db-migrate` command now refuses whenever a hosted credential or
  authority resolves from ANY tier, and prints a LOCAL mode line on stderr when it runs.

Behaviour worth knowing about:

- Hosted with no credential still FAILS LOUD: non-zero exit, no SQLite, no
  `*-local-fallback` event, and the message names every tier it consulted plus the
  canonical `HASNA_CALENDAR_API_URL` / `HASNA_CALENDAR_API_KEY` names.
- The secrets-vault pointer tier (`HASNA_CALENDAR_API_KEY_REF`) is refused loudly on
  every surface: the Calendar transport resolves credentials synchronously at
  construction and cannot complete a vault pointer per request; use a literal tier.
- The generated SDK's per-request refresh re-runs the same chain resolution and
  overwrites `x-api-key`; a transient refusal keeps the constructed credential rather
  than failing a working client mid-flight.