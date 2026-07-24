# personalnotes-server

Self-hosted PersonalNotes sync server. A small reference implementation of the
`personalnotes/v1` wire dialect — the same protocol the hosted
[personalnotes.ai](https://personalnotes.ai) platform speaks — backed by a
single SQLite file. The `personalnotes` CLI/app talks to either backend
unchanged: one protocol, two backends.

- **Stack**: [Bun](https://bun.sh) + [Hono](https://hono.dev) + `bun:sqlite`. One runtime dependency.
- **Storage**: one SQLite file (default `~/.hasna/apps/notes-server/server.db`). Back it up by copying the file.
- **Scope**: notes CRUD, event-batch sync with idempotency and a lossless
  monotonic pull cursor, device-code auth, export, health. No billing, no
  multi-tenant admin, no email service — those are hosted-platform concerns.

## Quickstart

```sh
# from this directory (or the repo root with server/index.mjs)
bun install
bun index.mjs --auto-approve
# → [personalnotes-server] v0.1.0 listening on http://127.0.0.1:8788
# → [personalnotes-server] database: ~/.hasna/apps/notes-server/server.db
```

Point the client at it:

```sh
PERSONALNOTES_API_URL=http://127.0.0.1:8788 personalnotes cloud login --device
```

With `--auto-approve`, device logins coming from this machine (loopback) are
approved automatically and the CLI receives its `pn_...` API key on the first
poll — no browser, no email. Auto-approve attaches devices to the server's
first account (creating a placeholder owner on a fresh database); if you want
the account named after your email, do the OTP login below once before
relying on auto-approve. Without the flag, the server prints the user code on
its console and you approve it with a signed-in session:

```sh
# 1. sign in: the 6-digit code is printed on the SERVER console (no email needed)
curl -X POST http://127.0.0.1:8788/api/v1/auth/login  -d '{"email":"you@example.com"}'
curl -X POST http://127.0.0.1:8788/api/v1/auth/verify -d '{"email":"you@example.com","code":"123456"}'
# → { token, user, tenant, apiKey }   (apiKey is returned exactly once)

# 2. approve the device code the CLI showed you
curl -X POST http://127.0.0.1:8788/api/v1/auth/device/approve \
  -H 'authorization: Bearer <token>' -d '{"userCode":"XXXX-XXXX"}'
```

## Configuration

| Flag | Env | Default | Meaning |
|---|---|---|---|
| `--port <n>` | `PERSONALNOTES_SERVER_PORT`, `PORT` | `8788` | listen port |
| `--host [addr]` | `PERSONALNOTES_SERVER_HOST` | `127.0.0.1` | bind address; bare `--host` binds `0.0.0.0` |
| `--db <path>` | `PERSONALNOTES_SERVER_DB` | `~/.hasna/apps/notes-server/server.db` | SQLite file |
| `--auto-approve` | `PERSONALNOTES_SERVER_AUTO_APPROVE=1` | off | auto-approve loopback device logins |
| `--dev` | `PERSONALNOTES_SERVER_DEV=1` | off | include `devCode` in OTP responses (tests/dev) |
| | `PERSONALNOTES_SERVER_URL` | `http://<host>:<port>` | public URL used in `verificationUri` |
| | `PERSONALNOTES_SERVER_JWT_SECRET` | generated, persisted in DB | session-JWT secret |

The server binds loopback by default. If you expose it (`--host`), put a TLS
reverse proxy (Caddy, nginx, or your mesh VPN's proxy) in front — bearer keys must
not travel over plain HTTP outside your machine.

**macOS clients: do not point the sync daemon at a LAN address.** macOS Local
Network Privacy silently blocks background launchd agents from
RFC1918/link-local addresses — `EHOSTUNREACH`, and no permission prompt ever
appears for a background agent — so a client configured with
`http://192.168.x.x:8788` (or a bare hostname that resolves there) syncs fine
when run manually and fails under the installed daemon. Give macOS clients a
non-LAN address: a Tailscale MagicDNS FQDN (`http://<host>.<tailnet>.ts.net:8788`
— mesh-VPN traffic rides utun and is not LNP-gated) or a public hostname behind
your proxy. `personalnotes sync --install-service` detects this on macOS and
rewrites the URL to the tailnet FQDN when one is available (`--dry-run` to
preview).

## API surface (personalnotes/v1 dialect)

```
GET  /health                          GET  /api/v1  (discovery: {version, service, dialect})
POST /api/{auth,v1/auth}/login        POST /api/{auth,v1/auth}/verify
POST /api/{auth,v1/auth}/device/start|token|exchange
POST /api/v1/auth/device/approve      (session-authenticated)
GET  /api/v1/auth/whoami              POST /api/v1/auth/logout
GET|POST /api/v1/api-keys
GET|POST /api/v1/notes                GET|PATCH|DELETE /api/v1/notes/:id
POST /api/v1/sync                     (Idempotency-Key required)
POST /api/v1/export
```

Dialect supersets over the hosted platform (each degrades gracefully; see the
`PLATFORM-GAP` comments in the source):

- **Lossless pull cursor**: sync `changes` are ordered by a per-tenant
  monotonic `seq`, the cursor is opaque (`s:<seq>`), and responses carry
  `hasMore`. ISO-timestamp cursors (the hosted platform's shape) are still
  accepted with a 5-second overlap rewind.
- **List pagination**: `GET /api/v1/notes?cursor=&limit=` → `{data, nextCursor}`.
- **Purge**: sync item `{"clientId":..., "purged":true}` scrubs
  title/body/frontmatter/labels, stamps `purgedAt`, and keeps propagating only
  the empty tombstone.
- **Audit events**: `note.purged`, `note.restored`, `note.archived`,
  `note.unarchived` recorded in `note_events`.

## Run it as a service

### systemd (Linux)

```ini
# /etc/systemd/system/personalnotes-server.service
[Unit]
Description=PersonalNotes self-hosted sync server
After=network.target

[Service]
ExecStart=/usr/local/bin/bun /opt/personalnotes/server/index.mjs
Environment=PERSONALNOTES_SERVER_PORT=8788
Environment=PERSONALNOTES_SERVER_DB=/var/lib/personalnotes/server.db
User=notes
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now personalnotes-server
```

### launchd (macOS)

```xml
<!-- ~/Library/LaunchAgents/com.personalnotes.server.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.personalnotes.server</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/bun</string>
    <string>/Users/you/personalnotes/server/index.mjs</string>
    <string>--auto-approve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

```sh
launchctl load ~/Library/LaunchAgents/com.personalnotes.server.plist
```

## Tests

```sh
cd server && bun test
```

Covers boot (real `bun index.mjs` process), auth (OTP, device flow,
auto-approve, logout), notes CRUD, sync round-trip with `baseRevision`
conflicts, idempotent replay (same key/same body → verbatim replay; same
key/different body → `409 idempotency_conflict`), tombstone/purge/restore
propagation, and cursor pagination (seq paging, ISO backcompat, list cursor).
