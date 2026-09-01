# notes-server

Self-hosted Hasna Notes server. A small reference implementation of the
`personalnotes/v1` wire dialect — the same protocol the hosted platform
speaks — backed by SQLite (PostgreSQL via `HASNA_NOTES_DATABASE_URL`). The
`notes` client talks to it over HTTP: one protocol.

- **Stack**: [Bun](https://bun.sh) + [Hono](https://hono.dev) + `bun:sqlite`. One runtime dependency.
- **Storage**: one SQLite file at the XDG-native `@hasna/paths` data root. Back it up by copying the file.
- **Scope**: notes CRUD, device-code auth, export, health. The multi-machine
  sync round-trip endpoint and its `sync_batches` table were removed in 0.2.0.
  No billing, no multi-tenant admin, no email service — those are
  hosted-platform concerns.

## Quickstart

```sh
# from this directory (or the repo root with server/index.mjs)
bun install
bun index.mjs --auto-approve
# → [notes-server] v0.1.0 listening on http://127.0.0.1:8788
# → [notes-server] database: <XDG data root>/hasna/notes/server.db
```

Point a client at it:

```sh
HASNA_NOTES_API_URL=https://notes.example.test HASNA_NOTES_API_KEY=pn_... notes ...
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
| `--port <n>` | `HASNA_NOTES_SERVER_PORT`, `PORT` | `8788` | listen port |
| `--host [addr]` | `HASNA_NOTES_SERVER_HOST` | `127.0.0.1` | bind address; bare `--host` binds `0.0.0.0` |
| `--db <path>` | `HASNA_NOTES_SERVER_DB` | `<XDG data root>/hasna/notes/server.db` | SQLite file resolved via `@hasna/paths`; legacy roots require explicit migration |
| `--auto-approve` | `HASNA_NOTES_SERVER_AUTO_APPROVE=1` | off | auto-approve loopback device logins |
| `--dev` | `HASNA_NOTES_SERVER_DEV=1` | off | include `devCode` in OTP responses (tests/dev) |
| | `HASNA_NOTES_SERVER_URL` | `http://<host>:<port>` | public URL used in `verificationUri` |
| | `HASNA_NOTES_SERVER_JWT_SECRET` | generated, persisted in DB | session-JWT secret |

The server binds loopback over HTTP by default. Canonical Notes clients require
HTTPS, so put a TLS reverse proxy in front of it before connecting a client.
Bearer keys must not travel over plain HTTP.

If a client reaches this server over the LAN, keep the address out of any
background/service context: macOS Local Network Privacy silently blocks
background launchd agents from RFC1918/link-local addresses (`EHOSTUNREACH`,
no permission prompt). Give clients a non-LAN address — a Tailscale MagicDNS
FQDN (`http://<host>.<tailnet>.ts.net:8788`, mesh traffic is not LNP-gated) or
a public hostname behind your TLS proxy. Configure the client with that HTTPS
hostname, never the server's loopback HTTP listener.

## API surface (personalnotes/v1 dialect)

```
GET  /health                          GET  /api/v1  (discovery: {version, service, dialect})
POST /api/{auth,v1/auth}/login        POST /api/{auth,v1/auth}/verify
POST /api/{auth,v1/auth}/device/start|token|exchange
POST /api/v1/auth/device/approve      (session-authenticated)
GET  /api/v1/auth/whoami              POST /api/v1/auth/logout
GET|POST /api/v1/api-keys
GET|POST /api/v1/notes                GET|PATCH|DELETE /api/v1/notes/:id
POST /api/v1/export
```

The `POST /api/v1/sync` round-trip endpoint was removed with the multi-machine
sync machinery (0.2.0); the client is a plain HTTP API client using CRUD and
export.

Dialect supersets over the hosted platform (each degrades gracefully; see the
`PLATFORM-GAP` comments in the source):

- **List pagination**: `GET /api/v1/notes?cursor=&limit=` → `{data, nextCursor}`
  (opaque `s:<seq>` cursor; ISO-timestamp cursors accepted with a 5-second
  overlap rewind).
- **Purge**: a `purgedAt` tombstone scrubs title/body/frontmatter/labels and
  keeps deleted content from flowing in feeds.
- **Audit events**: `note.purged`, `note.restored`, `note.archived`,
  `note.unarchived` recorded in `note_events`.

## Run it as a service

### systemd (Linux)

```ini
# /etc/systemd/system/notes-server.service
[Unit]
Description=Hasna Notes self-hosted server
After=network.target

[Service]
ExecStart=/usr/local/bin/bun /opt/notes-server/index.mjs
Environment=HASNA_NOTES_SERVER_PORT=8788
Environment=HASNA_NOTES_SERVER_DB=/var/lib/notes-server/server.db
User=notes
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now notes-server
```

### launchd (macOS)

```xml
<!-- ~/Library/LaunchAgents/com.hasna.notes.server.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.hasna.notes.server</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/bun</string>
    <string>/Users/you/notes-server/index.mjs</string>
    <string>--auto-approve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

```sh
launchctl load ~/Library/LaunchAgents/com.hasna.notes.server.plist
```

## Tests

```sh
cd server && bun test
```

Covers boot (real `bun index.mjs` process), auth (OTP, device flow,
auto-approve, logout), notes CRUD, purge/restore propagation, and cursor
pagination.
