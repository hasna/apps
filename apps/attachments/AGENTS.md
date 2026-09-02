# @hasna/attachments

Clients (CLI, MCP, package root and ./sdk) use authenticated HTTPS only.
Set HASNA_ATTACHMENTS_API_URL and HASNA_ATTACHMENTS_API_KEY explicitly.
Missing, blank, conflicting and insecure configuration fails before data access.
Retired mode selectors, database URLs and SQLite paths are not client inputs.

The attachments-serve service requires a server-only PostgreSQL DSN and signing key.
SQLite and the old attachments serve command are not supported service backends.
S3 configuration belongs on the service, not on clients.

Configuration uses @hasna/paths. Legacy data stays untouched; do not automatically
discover, copy, delete or import it. Any import requires a separate reviewed plan.

Todos/Sessions integrations require their own HTTPS URL and key environment pair.
No redirect following, write retry, unauthenticated localhost default or local fallback.

See docs/configuration.md and docs/canonical-migration.md for migration limitations.
