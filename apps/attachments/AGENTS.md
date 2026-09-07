# @hasna/attachments

Clients (CLI, MCP, package root and ./sdk) resolve their store through the ONE
store seam (`resolveStore`): hosted transport via the shared `@hasna/contracts`
resolver (pinned exact 1.0.2), fresh on every call — there is no per-app
environment chain to maintain and no place to add a deprecated tier. The
resolver reads, per call: an explicit `--api-key`/`--profile`, then
`HASNA_ATTACHMENTS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
`HASNA_ATTACHMENTS_API_KEY_REF`, then the macOS Keychain item
`hasna.credentials.attachments.api-key` (account `HASNA_STATION`, else
`hostname -s`, else `USER`), then `~/.hasna/attachments/config/credentials`
(owner-only 0400/0600), then `HASNA_ATTACHMENTS_API_KEY`. The authority
follows the same ladder — `HASNA_ATTACHMENTS_API_URL`, the Keychain `api-url`
item, the credentials file — and DEFAULTS to the fleet gateway
`https://api.hasna.com/attachments` once a credential resolves. The legacy
unprefixed `ATTACHMENTS_*` spellings remain only as the resolver's silent
alias fallback for one release, always below the canonical names.

Missing, blank, conflicting and insecure configuration fails before data
access; hosted mode with no credential exits non-zero — there is no local
fallback and no `*_MODE` / `*_STORAGE_MODE` selector (the retired mode words
are inert; nothing reads them). The ON-BOX local transport is a separate,
deliberate opt-in (see `core/local-opt-in.ts`): `HASNA_ATTACHMENTS_DB_PATH` /
`ATTACHMENTS_DB_PATH` (explicit file, precedence 1) or
`HASNA_ATTACHMENTS_LOCAL=1` / `ATTACHMENTS_LOCAL=1` when no authority is
configured — answered WITHOUT the resolver, and announced on stderr
(`attachments: LOCAL mode …`) so a local run can never be mistaken for a
hosted one. It is never a fallback from a failed hosted resolution. Client
database URLs (raw server DSNs), SQLite paths named by mode words and
`--client-mode` are not client inputs. Nothing reads `~/.hasna/fleet-env`,
`~/.hasna/cloud`, `~/.config/hasna`, `$XDG_CONFIG_HOME` or any
`~/.attachments/config.json` key store.

The attachments-serve service requires a server-only PostgreSQL DSN and
signing key, and wires its API-key verifier through the store's `keyStatus`
hook (1.0.2 auth contract). SQLite is the CLI's on-box client database; the
SERVICE backend is PostgreSQL only. S3 configuration belongs on the service
for the hosted path; the on-box transport may hold its own object-storage
details (see `attachments config set` and the MCP `configure_s3` tool) so
local presigned uploads can be minted.

Todos/Sessions integrations resolve their own HTTPS URL and key through the
same shared seam (`@hasna/contracts` client chain for `todos` / `sessions`),
credential pinned to the authority it resolved with. No redirect following,
write retry, unauthenticated localhost default or local fallback.

Configuration uses @hasna/paths. Legacy data stays untouched; do not
automatically discover, copy, delete or import it. Any import requires a
separate reviewed plan.

See docs/configuration.md, docs/cli.md and docs/canonical-migration.md for
the resolver chain, the env table and migration limitations.