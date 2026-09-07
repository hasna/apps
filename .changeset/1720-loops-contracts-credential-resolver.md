---
"@hasna/loops": minor
---

Adopt the shared `@hasna/contracts` 1.0.2 credential resolver (hasna/apps#1720).

**Client connections.** The hosted `/v1` connection is now selected by the
shared resolver: the macOS Keychain items `hasna.credentials.loops.api-key` /
`.api-url` (account `HASNA_STATION`, else the short hostname, else `USER`), the
credential file `~/.hasna/loops/config/credentials` (`HASNA_HOME` /
`HASNA_CONFIG_HOME` relocate it; XDG is never consulted), `HASNA_LOOPS_API_KEY`
in the environment, and the fleet gateway default `https://api.hasna.com/loops`
once a credential has resolved. The CLI, the MCP server and the SDK all resolve
per request/call through this one seam, so a station needs no inline env prefix
and a key rotation heals a long-lived process without a restart.

- The local SQLite file connection remains available **only** through the
  explicit opt-in `HASNA_LOOPS_CONNECTION=file`, which now announces itself
  ("local mode") on stderr. A configured environment outranks the opt-in and a
  half-configured one fails loudly instead of downgrading.
- Hosted with no credential fails closed: non-zero exit, no SQLite file
  opened, no local-fallback event. The retired `HASNA_LOOPS_CONNECTION=api`
  value and the former `HASNA_LOOPS_STORAGE_MODE` switch are no longer read.
- The app's own env chain is removed: the `~/.hasna/cloud/*.env` loader is
  deleted, and the runner no longer injects client env files into spawned
  CLIs.
- Env handling follows the `@hasna/contracts` ambient gate (hasna/apps#1788):
  declared-but-blank authority variables are normalised without handing the
  resolver a caller-built copy, so the machine's Keychain tier survives.
- The SDK's explicit `baseUrl` without an `apiKey` never attaches the ambient
  fleet key (hasna/apps#1794).