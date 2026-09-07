---
"@hasna/economy": minor
---

Resolve credentials through the `@hasna/contracts` 1.0.2 client chain (hasna/apps#1720).

The CLI, the MCP server and the `./sdk` store surface no longer carry a
credential chain of their own. All three route through the one resolver in
`@hasna/contracts` (bumped from 0.13.4 to the exact 1.0.2), which reads, per
call: an explicit `--api-key`/`--profile`, then `HASNA_ECONOMY_API_KEY_OVERRIDE`
/ `HASNA_PROFILE` / `HASNA_ECONOMY_API_KEY_REF`, then the macOS Keychain item
`hasna.credentials.economy.api-key`, then `~/.hasna/economy/config/credentials`
(0600, `HASNA_ECONOMY_API_KEY=…`), then `HASNA_ECONOMY_API_KEY`. The authority
follows the same ladder — `HASNA_ECONOMY_API_URL`, the Keychain `api-url` item,
the credentials file — and now DEFAULTS to the fleet gateway
`https://api.hasna.com/economy` once a credential resolves, so a key alone is a
complete configuration. A long-lived MCP server re-resolves the credential on
every request, so a rotation heals without a restart.

What this removes:

- The app's own legacy env chain: the unprefixed serve token `ECONOMY_API_TOKEN`
  (canonical `HASNA_ECONOMY_API_TOKEN` remains) and `ECONOMY_MACHINE_ID`
  (canonical `HASNA_ECONOMY_MACHINE_ID`).
- Retired `*_MODE` / `*_STORAGE_MODE` switches stay a hard error, and the
  DEPRECATED notice is gone: `HASNA_ECONOMY_API_KEY` is a legitimate resolver
  tier, it just sits below the Keychain and the credentials file.
- Nothing reads `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna` or
  `$XDG_CONFIG_HOME` — the resolver never consults those locations.

What this keeps and adds:

- Fail loud (owner directive 2026-09-04): hosted with no credential = non-zero
  exit, no SQLite file, no `economy-local-fallback` event, and an error naming
  every tier consulted. Local mode is served only by the explicit opt-in
  `HASNA_ECONOMY_LOCAL=1` (alias `ECONOMY_LOCAL=1` for one release), which
  yields to every hosted signal and now prints one `economy: local mode …` line
  on stderr.
- `economy transport` (new CLI command): reports the resolved transport and the
  credential SOURCE — `/v1` authority, `api_url_source`, `api_key_source`,
  `api_key_tier` — never the key value; `--json` for the full report. It is the
  one surface that reports a refusal instead of throwing.
- The `./sdk` store surface (`getStore`) is unchanged in shape, and it is the
  ONLY SDK: the Store takes no `baseUrl`, so the package can never attach an
  ambient fleet key to a caller-supplied one (hasna/apps#1794) — the authority
  and the credential both come from the resolver, per call.
- `@hasna/contracts` stays a runtime dependency (economy builds with
  `--packages external`), so the published declarations importing its types
  resolve for consumers. The `/v1/machines` and `/v1/fleet` surfaces are
  unchanged and keep working against the resolved authority.