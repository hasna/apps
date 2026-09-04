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

Point a client at the loopback listener during development:

```sh
HASNA_NOTES_API_URL=http://127.0.0.1:8788 HASNA_NOTES_API_KEY=pn_... notes ...
```

With `--auto-approve`, device logins coming from this machine (loopback) are
approved automatically and the CLI receives its `pn_...` API key on the first
poll — no browser, no email. Auto-approve attaches devices to the server's
first account (creating a placeholder owner on a fresh database); if you want
the account named after your email, do the OTP login below once before
relying on auto-approve. Without the flag, approve the device code your
client shows you with a signed-in session:

```sh
# 1. sign in: one-time login codes are NEVER written to the server log.
#    Get the code from the OTP response in dev mode (--dev / HASNA_NOTES_SERVER_DEV=1
#    adds devCode) or opt into console delivery for self-hosting with
#    HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1.
curl -X POST http://127.0.0.1:8788/api/v1/auth/login  -d '{"email":"you@example.com"}'
curl -X POST http://127.0.0.1:8788/api/v1/auth/verify -d '{"email":"you@example.com","code":"123456"}'
# → { token, user, tenant, apiKey }   (apiKey is returned exactly once)

# 2. approve the device code the CLI showed you
curl -X POST http://127.0.0.1:8788/api/v1/auth/device/approve \
  -H 'authorization: Bearer <token>' -d '{"userCode":"XXXX-XXXX"}'
```

The listener defaults to loopback HTTP. Terminate TLS before connecting a client:
all canonical Notes clients require HASNA_NOTES_API_URL with HTTPS and
HASNA_NOTES_API_KEY. No automatic client login/local fallback is provided.

## Configuration

| Flag | Server environment | Default | Meaning |
|---|---|---|---|
| --port <n> | HASNA_NOTES_SERVER_PORT, PORT | 8788 | listen port |
| --host [addr] | HASNA_NOTES_SERVER_HOST | 127.0.0.1 | bind address; bare `--host` binds 0.0.0.0 |
| --auto-approve | HASNA_NOTES_SERVER_AUTO_APPROVE=1 | off | auto-approve loopback device logins |
| --dev | HASNA_NOTES_SERVER_DEV=1 | off | include devCode in OTP responses (tests/dev) |
| | HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1 | off | print OTP login codes to the server console — explicit opt-in for self-hosting; never set in hosted/prod deploys (codes in logs = account takeover for anyone with log access) |
| | HASNA_NOTES_SERVER_URL | loopback listener URL | public URL used in `verificationUri` |
| | HASNA_NOTES_SERVER_JWT_SECRET | generated and persisted server-side | session-JWT secret |
| | HASNA_NOTES_DATABASE_URL | required PostgreSQL URL | storage backend (see below) |
| | HASNA_NOTES_API_SIGNING_KEY | required signing key | api-key auth (api-key signing secret) |

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
