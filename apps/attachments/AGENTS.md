# @hasna/attachments

Clients (CLI, MCP, package root and ./sdk) use authenticated HTTPS only.
Credential and authority resolution goes through the ONE shared resolver in
`@hasna/contracts` (pinned exact 1.0.2), fresh on every call — there is no
per-app environment chain to maintain and no place to add a deprecated tier.
The resolver reads, per call: an explicit `--api-key`/`--profile`, then
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
access; hosted mode with no credential exits non-zero — there is no SQLite
fallback, no local-fallback event, no local default and no `*_MODE` /
`*_STORAGE_MODE` selector. Retired mode selectors, database URLs, SQLite
paths and `--client-mode` are not client inputs. Nothing reads
`~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`, `$XDG_CONFIG_HOME`
or any `~/.attachments/config.json` key store.

The attachments-serve service requires a server-only PostgreSQL DSN and
signing key, and wires its API-key verifier through the store's `keyStatus`
hook (1.0.2 auth contract). SQLite and the old attachments serve command are
not supported service backends. S3 configuration belongs on the service, not
on clients.

Todos/Sessions integrations resolve their own HTTPS URL and key through the
same shared seam (`@hasna/contracts` client chain for `todos` / `sessions`),
credential pinned to the authority it resolved with. No redirect following,
write retry, unauthenticated localhost default or local fallback.

Configuration uses @hasna/paths. Legacy data stays untouched; do not
automatically discover, copy, delete or import it. Any import requires a
separate reviewed plan.

See docs/configuration.md, docs/cli.md and docs/canonical-migration.md for
the resolver chain, the env table and migration limitations.