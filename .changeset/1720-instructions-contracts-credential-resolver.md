---
"@hasna/instructions": minor
---

Resolve credentials through the `@hasna/contracts` client chain (hasna/apps#1720).

The CLI, the MCP server and the SDK no longer carry a credential chain of their
own. All three call the one resolver in `@hasna/contracts` (pinned to 1.0.2),
which reads, per call: an explicit `--api-key`/`--profile`, then
`HASNA_INSTRUCTIONS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
`HASNA_INSTRUCTIONS_API_KEY_REF`, then the macOS Keychain item
`hasna.credentials.instructions.api-key`, then
`~/.hasna/instructions/config/credentials` (owner-only 0400/0600), then
`HASNA_INSTRUCTIONS_API_KEY`. The authority follows the same ladder —
`HASNA_INSTRUCTIONS_API_URL`, the Keychain `api-url` item, the credentials file
— and now DEFAULTS to the fleet gateway `https://api.hasna.com/instructions`
once a credential resolves, so a key alone is a complete configuration.
Resolving per call is what makes a key rotation heal a long-lived shell, MCP
server or agent without restarting it: the contracts transport re-resolves the
credential on every request, so the next request after a rotation carries the
new key. The two deliberate exceptions are an explicit `apiKey` argument (tier
1, a pin the caller owns) and the service authority, which is fixed for the
life of a client so a credential written for one authority is never sent to
another.

What this removes:

- `resolveCloudConfig`, the `CloudConfig` type and the hand-rolled
  `CloudConfigStore` fetch client with its own `HASNA_INSTRUCTIONS_API_URL` /
  `HASNA_INSTRUCTIONS_API_KEY` env reads, 30s AbortController timeout and
  bearer-header plumbing (breaking, hence minor). The store now wraps the
  shared authenticated transport, which sends the key as both `x-api-key` and
  `Authorization: Bearer`, times out, retries transient failures, and hides
  401/403 response bodies (the one place a rejected request can reflect
  credential material back into logs).
- `CloudHttpError` (breaking): HTTP failures surface as the transport's
  `HasnaHttpError` shape (matched by name + status, never `instanceof`, so the
  check holds across bundle boundaries). `isCloudAuthError` and
  `formatCliError` now recognise that shape.
- `missingFleetEnvError` (breaking): the fail-closed refusal now comes from the
  resolver seam as a stable `REMOTE_API_CONFIG_MISSING` /
  `REMOTE_API_KEY_MISSING` / `REMOTE_API_CREDENTIAL_INVALID` /
  `REMOTE_API_URL_INVALID` error that names every tier it consulted.
- The retired-chain rejection module: `~/.hasna/fleet-env`, `~/.hasna/cloud`,
  `~/.config/hasna`, `$XDG_CONFIG_HOME` and a `~/.instructions/config.json`
  key store are inputs nowhere, and no `*_MODE` / `*_STORAGE_MODE` variable is
  read — the transport is decided by what RESOLVES, never by a mode word.
- The `configs`/`@hasna/instructions` local guard no longer keys off the env
  pair alone; any configured authority/credential intent refuses a local DB
  open (the resolver's env-key set, so a lone `HASNA_INSTRUCTIONS_API_KEY`
  counts too).

What this adds:

- `getInstructionsTransportStatus` (and the CLI's `whoami` line behind it)
  reports `api_url_source`, `api_key_source` and `api_key_tier` — WHICH tier
  supplied the run's credential, never the value — plus the resolved
  `<origin>/v1` authority.
- `@hasna/instructions-sdk/resolve` exports
  `createInstructionsV1ClientFromEnv` and `resolveInstructionsSdkTransport`, so
  a consumer can build the hosted `/v1` client without writing a private copy
  of the chain. The base `@hasna/instructions-sdk` entry stays zero-dependency
  and browser-safe.
- The vendored storage kit (serve process) is regenerated from
  `@hasna/contracts` 1.0.2 (`src/generated/storage-kit`, `kitVersion` 1.0.2),
  fixing the stale 0.13.1 kit against the 0.14.2+ dependency.

Behaviour worth knowing about:

- Hosted mode with no credential still fails closed — non-zero exit, no SQLite
  fallback, no local-fallback event — and the message names every tier it
  consulted. A declared-but-blank authority variable is removed before the
  resolver sees it, so "blank means unset" keeps working at the Instructions
  seam; removing a blank hands the resolver a COPY of the environment, and the
  Keychain tier's ambient gate now travels across that copy as
  `keychain.enabled` instead of being silently lost (hasna/apps#1788).
- Local mode (`HASNA_INSTRUCTIONS_LOCAL=1`) is honoured only when the
  environment configures no authority and no credential, and is answered
  BEFORE the resolver runs, so an unhosted run reads neither the Keychain nor
  the credential file. Every local run now prints one line on stderr saying it
  is local.
- SDK explicit-URL rule (hasna/apps#1794): an explicit `baseUrl` without an
  explicit `apiKey` throws — the SDK never attaches the machine's fleet
  credential to an authority the caller chose itself.
- The Keychain item `hasna.credentials.instructions.api-key` and
  `~/.hasna/instructions/config/credentials` are NEW tiers for this app: a
  station whose key lives there (as it does for every other hosted Hasna CLI)
  now resolves without any env export.
