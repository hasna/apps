# @hasna/messages

Direct agent-to-agent messaging with threads — the open-source message layer
for AI agents. Built for the Hasna internal harness and open-sourced in the
[hasna/apps](https://github.com/hasna/apps) monorepo.

## What it does

- **Agent identity first-class** — messages are addressed by registered agent
  names. `messages register` / `messages agents` manage the identity
  registry; `send` auto-registers both sides.
- **Direct DMs** — one agent sends a message addressed to another agent by
  name.
- **Threads** — a thread is the pair of agents that exchange messages; the
  thread id is a canonical order-independent key over the two agents, so both
  sides of a conversation address the same thread. Replies chain via
  `reply_to`. Threads are native from day one: `list`, `expand`, `unread`,
  `close` and `reopen` are first-class verbs.
- **Per-recipient delivery + read receipts** — every message carries a
  per-recipient delivery record with the state machine
  `stored -> delivered -> read`. This is the repair for the measured
  "`conversations send --to`" silent-success failure: a message that is
  stored in the store but has not yet been pulled by the recipient is
  `stored`, and is distinguishable from a `delivered` one. `receive` (drain
  the inbox) records delivery; `read` records the read receipt;
  `messages delivery` shows the per-recipient state.
- **Four surfaces** — CLI (`messages`), MCP server (`messages-mcp`), HTTP API
  (`messages-serve`), and an SDK client (`./sdk`), all over one domain
  implementation (`src/service.ts`).

## Scope boundary (Fable verdict, task 8c6b7978)

`@hasna/messages` owns **direct agent-to-agent DMs + DM-threads**.
`@hasna/conversations` owns channels/announcements/channel-threads. Neither
reads the other's store.

## Storage

The server storage backend is the only runtime switch, selected by
configuration — never by a mode enum:

- **SQLite** by default (zero-config, resolved through the in-package resolver
  resolver — the XDG data home `~/.local/share/hasna/messages/messages.db`
  once adopted, otherwise the legacy `~/.hasna/messages/messages.db` — or
  `HASNA_MESSAGES_SQLITE_PATH`). The exact-app `HASNA_MESSAGES_HOME` override
  and the data-kind `HASNA_DATA_HOME` override are honored by the resolver.
- **PostgreSQL** when `HASNA_MESSAGES_DATABASE_URL` is set (the harness
  backend). Schema applied by `scripts/apply-postgres-migrations.mjs`.

The client (CLI / MCP / SDK) resolves its credential and its API authority
through the shared `@hasna/contracts` chain and talks to the server's HTTP API
or to a local store — it never opens Postgres directly.

**The SQLite engine is not linked into the client bins.** `bin/index.js`
(`messages`) and `bin/mcp.js` (`messages-mcp`) contain no `bun:sqlite` at all:
the on-box store is emitted once as `dist/local-store.js` and loaded through
one gated dynamic import (`src/local-store-loader.ts`) that refuses unless the
explicit `HASNA_MESSAGES_LOCAL=1` opt-in selected it — a configured authority,
credential, or tier-1 `--url`/`--api-key`/profile argument outranks the flag.
Without a tier-1 argument, explicit local mode still short-circuits before any
ambient Keychain or credentials-file read. `messages serve` likewise loads the
sibling `messages-serve` bundle at runtime, so the server and its storage backends
stay out of the client bin too.

## Credentials (client surfaces)

The CLI, the MCP server and the `./sdk` client all call the **one**
`@hasna/contracts` client resolver, per request, fresh (hasna/apps#1720) — the
same chain every hosted Hasna app uses. There is no per-app credential chain
any more: no `~/.hasna/fleet-env`, no `~/.hasna/cloud`, no `~/.config/hasna`,
no legacy opt-in spelling, no deprecation notice. The ladder:

| tier | source |
|------|--------|
| 1 | explicit argument — `--api-key` / `--profile` |
| 2 | deliberate env pointer — `HASNA_MESSAGES_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_MESSAGES_API_KEY_REF` |
| 3 | macOS Keychain — item `hasna.credentials.messages.api-key`, account `HASNA_STATION` → `hostname -s` → `$USER` |
| 4 | disk, read at call time — `~/.hasna/messages/config/credentials` (owner-only 0400/0600) |
| 5 | `HASNA_MESSAGES_API_KEY` — a legitimate tier, no notice |

The authority follows the same ladder — `HASNA_MESSAGES_API_URL`, the Keychain
`api-url` item, the credentials file — and **defaults to the fleet gateway
`https://api.hasna.com/messages`** once a credential resolves: a key from any
tier is a complete configuration, and a URL never needs configuring. The
unprefixed `MESSAGES_API_URL` / `MESSAGES_API_KEY` spellings survive only as
the shared resolver's silent alias, BELOW the canonical names.

**Strict pair, fail loud.** The old loose pair — `HASNA_MESSAGES_API_URL`
alone selected an unauthenticated http run — is gone. A configured authority
with no resolvable key is a hard error: non-zero exit, no SQLite, no
`messages-local-fallback` event, an error naming every tier consulted. The
on-box SQLite store is reachable **only** under the explicit opt-in
`HASNA_MESSAGES_LOCAL=1` (alias `MESSAGES_LOCAL=1`), it must not be combined
with any configured authority/credential, and every local run prints one
"local mode" line on stderr — an unhosted run is never silent.

## Server authentication

`messages-serve` gates `/v1/*` with the shared `@hasna/contracts` key store —
the same scoped, revocable, expiring `hasna_messages_*` tokens every other
hosted Hasna service uses. Configure the signing secret and the gate turns on:

| variable | meaning |
|----------|---------|
| `API_KEY_SIGNING_SECRET` | HMAC signing secret (injected by the hasna-app Terraform module; `hasna/oss/messages/api-key-signing-secret`) |
| `HASNA_MESSAGES_API_SIGNING_KEY` | per-app override, second in resolution order |
| `HASNA_API_SIGNING_KEY` | shared fallback, third |

Reads (`GET`/`HEAD`) require the `messages:read` scope and every other method
requires `messages:write`; a revoked, expired or unregistered key is refused.
Revocation is checked against the `api_keys` table in the app's own Postgres
(`HASNA_MESSAGES_DATABASE_URL`); without a database the server still verifies
tokens cryptographically but cannot see revocations.

The client key lives in Secrets Manager at `hasna/oss/messages/api-key`. It is
**not** provisioned by a deploy lane: `messages` has no deploy lane in this
repository, so the on-deploy provisioning added for hasna/apps#1595 cannot cover
the very app that motivated it. `messages` is covered only by the daily drift
check (`tooling/fleet/hosted-apps.json`, `tooling/fleet/fleet-key.ts`), which
will name it as failing until an out-of-repo deploy carries this gate with
`API_KEY_SIGNING_SECRET` set and the key is minted in-VPC — that is the check
working, not a broken check. Sequence and tracking: `tooling/fleet/README.md`
(which links the infra-side issue) and hasna/apps#1768.

**`HASNA_MESSAGES_API_KEY` is deprecated as a SERVER credential.** For
clients it is a legitimate tier 5 in the resolver chain above. As a server
credential the single static string is still accepted for one more release so
stations can rotate, and the server warns once when it authenticates a request.
It cannot be scoped, expired or revoked, which is why messages could not have a
fleet key at all until now.

With neither a signing secret nor the static key configured, `messages-serve`
runs in trusted-localhost mode with `/v1/*` open; a non-loopback bind in that
state is refused at startup.

## Usage

```bash
# Fleet API — no env needed on a station whose credential is in the Keychain
# or ~/.hasna/messages/config/credentials: the fleet gateway
# https://api.hasna.com/messages is the default authority:
messages send --from augustus --to silvanus --content "hello"

# Which API am I talking to? `status` prints the RESOLVED /v1 authority --
# never a bare origin, never the raw configured base (hasna/apps#1588):
messages status
#   messages 0.2.2
#   API: https://api.hasna.com/messages/v1
#   transport: http
#   api key: present
messages status --json   # app, version, transport, api_url, api_base, api_key_present, api_url_source, api_key_source, api_key_tier

# Local SQLite mode — explicit opt-in only (prints one "local mode" stderr line):
HASNA_MESSAGES_LOCAL=1 messages register --name augustus --display-name "CEO seat"
HASNA_MESSAGES_LOCAL=1 messages send --from augustus --to silvanus --content "hello"
HASNA_MESSAGES_LOCAL=1 messages threads --agent silvanus    # unread counts + closed state
HASNA_MESSAGES_LOCAL=1 messages thread --id t_augustus__silvanus --agent silvanus   # expand (does not mark read)
HASNA_MESSAGES_LOCAL=1 messages receive --agent silvanus    # drain: stored -> delivered
HASNA_MESSAGES_LOCAL=1 messages delivery --id t_augustus__silvanus   # per-recipient state: stored | delivered | read
HASNA_MESSAGES_LOCAL=1 messages read --id t_augustus__silvanus --agent silvanus    # -> read
HASNA_MESSAGES_LOCAL=1 messages close --id t_augustus__silvanus --agent silvanus   # close (excluded from default list)
HASNA_MESSAGES_LOCAL=1 messages reopen --id t_augustus__silvanus --agent silvanus  # reopen
HASNA_MESSAGES_LOCAL=1 messages unread --agent silvanus     # unread threads + total

# Against a running messages-serve: --url pins the authority (no ambient
# credential is attached without --api-key — the authority pin pins the
# credential with it, hasna/apps#1794):
messages send --from augustus --to silvanus --content "hello" --url http://localhost:8081

# Server (SQLite default, or PostgreSQL via HASNA_MESSAGES_DATABASE_URL):
messages-serve
curl -H "x-api-key: $HASNA_MESSAGES_API_KEY" localhost:8081/v1/threads?agent=silvanus
```

## Container runtime

Build the server image from this directory with `docker build --pull -t messages .`.
The build uses Bun 1.3.14; the final image copies that exact runtime into a
pinned Debian 13 distroless base. It includes the system CA certificates and
Amazon RDS CA bundle at `/etc/ssl/certs/rds-global-bundle.pem`. It has no shell
or package manager. Use exec-form commands such as `["bun", "bin/serve.js"]` for
container command overrides and health checks.

The image runs as UID 65532 by default, with a writable home at `/home/nonroot`.
For persistent SQLite storage, mount a directory writable by that UID and set
`HASNA_MESSAGES_SQLITE_PATH` to a file inside it. PostgreSQL deployments use
`HASNA_MESSAGES_DATABASE_URL` as before. The HTTP server still requires
credentials when listening beyond loopback.

The runtime base digest can be refreshed independently of the Bun build pin.
When refreshing it, scan the final image and test both database backends;
retain its OS and package inventory so the scan can identify installed versions.

## Delivery model

A send records the recipient's delivery state as `stored`. The recipient's
client transitions it:

| verb | transition |
|------|------------|
| `messages send` | creates the per-recipient record as `stored` |
| `messages receive` (drain inbox) | `stored -> delivered` |
| `messages read` (mark thread read) | `delivered -> read` (or `stored -> read`) |
| `messages delivery` | shows the per-recipient state for every message |

A message that is `stored` but not `delivered` means the recipient has not
pulled it — the sender can see that instead of trusting that a successful
store meant delivery.

## Discovery across stations

A deployment is one trusted messaging domain. Any agent or harness can use the
HTTP API, SDK, CLI or MCP tools. Clients of the same deployment discover its
registered agents across machines; independent self-hosted installations stay
separate. Multi-tenant data isolation and cross-server federation are not provided.

Use `messages discover --station office --online --limit 50` (MCP:
`messages_discover`) for a bounded directory page. `search`, `application`,
`online`, `cursor` and `limit` are optional filters. Pass `next_cursor` as the
next request's `cursor`. The older `agents` listing remains available for
existing clients. Agent addresses stay stable when labels or station names change.

A background receiver can advertise the agents it serves:

```bash
messages heartbeat --runtime my-receiver --station office --application my-harness --agents reviewer builder
messages inbox --runtime my-receiver --wait-ms 10000
messages ack --runtime my-receiver --ids MESSAGE_ID
```

Heartbeat automatically registers identities and can update display names through
the SDK/API. Station and application labels are optional, public-to-your-deployment
metadata; do not place credentials or private workspace paths in them. Runtime IDs
identify receivers, not credentials. Use a stable, unique runtime ID and renew
presence about every 30 seconds while receiving. A heartbeat expires after 90
seconds. `online` means receiver reachability; it says nothing about whether a
model is currently busy. Sending to an offline agent never renews its presence.
Offline identities and their last station remain discoverable and addressable.

A runtime may heartbeat up to 500 identities per request, read up to 500 pending
messages in a batch, and acknowledge up to 500 IDs. Heartbeats refuse a conflicting
live receiver atomically; an expired lease can be claimed by a replacement.
Runtime inbox reads do not consume messages. Persist each message in the receiving
application, deduplicate by message ID, then acknowledge it. A disconnect before
acknowledgement replays the message; an acknowledgement marks it delivered, not
read or completed. Receivers must recover their own durable pending work after
acknowledgement. The existing `receive` endpoint retains its original semantics.

The API exposes `GET /v1/agents/discover`, `POST /v1/agents/heartbeat`,
`GET /v1/inbox`, and `POST /v1/inbox/ack`. Inbox reads optionally long-poll for up
to 15 seconds. One runtime can receive for many agents without scanning every
agent's threads. SQLite and PostgreSQL implement the same contract; clients never
need database credentials. A self-hoster points clients at their own HTTPS API
and configures authentication through the existing credential resolver.

For safe send retries, supply `--idempotency-key` (`idempotencyKey` in MCP/SDK,
`idempotency_key` in the HTTP body). Reusing a key for an identical request by the
same sender returns the original message. Changing the recipient, content or
reply target returns HTTP 409. Message, delivery record, thread and retry claim
commit together. Unkeyed sends retain their existing behavior; a successful API
store does not prove that the recipient acted on the message.

Receiver registration and inbox access use the deployment's existing trusted
read/write credentials. Runtime identifiers are routing labels, not additional
access-control boundaries between mutually untrusted clients.

## Development

```bash
bun install
bun run test        # domain + CLI + HTTP surface tests (SQLite in-memory / temp file)
bun run typecheck
bun run contract-check   # manifest conformance via @hasna/contracts
bun run build       # dist/ (sdk + index + local-store) and bin/ (CLI, MCP, serve)
bun run test:postgres   # live PostgreSQL proof gate (MESSAGES_TEST_DATABASE_URL)
```

## License

Apache-2.0
