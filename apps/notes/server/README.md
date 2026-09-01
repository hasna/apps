# Hasna Notes server

The PostgreSQL-only server implements the existing `personalnotes/v1` dialect.
It is shipped through `@hasna/notes` as `notes-serve`; the nested workspace
is not an independently supported publication artifact.

Before starting, provision the PostgreSQL schema with the server-side migration
runner and inject HASNA_NOTES_DATABASE_URL and HASNA_NOTES_API_SIGNING_KEY through
the approved runtime secret mechanism. Do not put DSNs/keys in shell history,
source, client environments or logs. Missing or invalid storage configuration
fails before the listener binds. There is no SQLite fallback.

```sh
bun server/index.mjs --port 8788
```

The listener defaults to loopback HTTP. Terminate TLS before connecting a client:
all canonical Notes clients require HASNA_NOTES_API_URL with HTTPS and
HASNA_NOTES_API_KEY. No automatic client login/local fallback is provided.

## Configuration

| Flag | Server environment | Default |
|---|---|---|
| --port <n> | HASNA_NOTES_SERVER_PORT, PORT | 8788 |
| --host [addr] | HASNA_NOTES_SERVER_HOST | 127.0.0.1 |
| --auto-approve | HASNA_NOTES_SERVER_AUTO_APPROVE=1 | off |
| --dev | HASNA_NOTES_SERVER_DEV=1 | off |
| | HASNA_NOTES_SERVER_URL | loopback listener URL |
| | HASNA_NOTES_SERVER_JWT_SECRET | generated and persisted server-side |
| | HASNA_NOTES_DATABASE_URL | required PostgreSQL URL |
| | HASNA_NOTES_API_SIGNING_KEY | required signing key |

The old --db/HASNA_NOTES_SERVER_DB selectors are rejected. SQLite survives only
as an explicitly injected, unshipped dialect-test fixture; production imports
do not load it. Copying legacy SQLite/Markdown through the maintenance command
does not import it into PostgreSQL or make it authoritative.

## API and verification

The server retains auth/OTP/device flow, API keys, CRUD at /api/v1/notes,
export at /api/v1/export, and /health, /ready, /version, /openapi.json.
The wire name remains `personalnotes/v1`; the separate PersonalNotes product
at `hasna-products/personalnotes` is unchanged. Multi-machine sync was removed.

Run `bun test` from apps/notes. Tests cover fail-closed real-process startup,
explicit legacy test fixtures, PGlite-backed PostgreSQL behavior, authentication,
CRUD, export and pagination. A real PostgreSQL service gate is separate:
`bun run test:pg` requires a disposable NOTES_TEST_DATABASE_URL and fails
closed when absent. No live service is contacted by the default tests.
