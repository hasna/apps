---
"@hasna/notes": minor
---

BREAKING (pre-1.0 minor, following this package's existing release convention):
Notes CLI, MCP, SDK and package-root imports now require an authenticated HTTPS
service via HASNA_NOTES_API_URL and HASNA_NOTES_API_KEY. Missing configuration
fails closed. The old unauthenticated local Markdown/SQLite CRUD path and client
database migration/DSN access are removed. The package root no longer exports
local CRUD; pure formatting helpers are available only through the explicitly
non-authoritative @hasna/notes/compat/markdown-format subpath.

notes-serve now requires a valid server-only HASNA_NOTES_DATABASE_URL and uses
PostgreSQL exclusively. The SQLite default, --db flag and
HASNA_NOTES_SERVER_DB selector are removed. SQLite is retained only in unshipped,
explicit test fixtures. Provision and migrate the server schema separately;
this release does not deploy a service or import legacy records into PostgreSQL.

Maintenance paths are XDG-native by default, rather than retaining the legacy
root until a physical migration has occurred. Legacy roots are never implicitly
selected or copied. Stop legacy writers and review storage migrate-legacy-path
--dry-run, then explicitly apply with --yes --plan-fingerprint <reviewed hash>.
The copy-only operation preserves source files, rejects conflicts/symlinks,
binds reviewed content and metadata, and never overwrites receipts. Copies are
non-authoritative import material, not a new local client store.

The wave-wide resolver dependency (@hasna/paths@0.1.0) was deleted 2026-09-03
(hasna/apps#1535); the resolver contract is now implemented locally in-package.

The separate hasna-products/personalnotes product, existing external resource
names, and personalnotes/v1 wire contract remain unchanged.