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

- **SQLite** by default (zero-config, resolved through the `@hasna/paths`
  resolver — the XDG data home `~/.local/share/hasna/messages/messages.db`
  once adopted, otherwise the legacy `~/.hasna/messages/messages.db` — or
  `HASNA_MESSAGES_SQLITE_PATH`). The exact-app `HASNA_MESSAGES_HOME` override
  and the data-kind `HASNA_DATA_HOME` override are honored by the resolver.
- **PostgreSQL** when `HASNA_MESSAGES_DATABASE_URL` is set (the harness
  backend). Schema applied by `scripts/apply-postgres-migrations.mjs`.

The client (CLI / MCP / SDK) resolves its credential and its API authority
through the shared `@hasna/contracts` chain and talks to the server's HTTP API
or to a local store — it never opens Postgres directly.

## Credentials (client surfaces)

The CLI, the MCP server and the `./sdk` client all call the **one**
`@hasna/contracts` client resolver, per request, fresh (hasna/apps#1720) — the
same chain every hosted Hasna app uses. There is no per-app credential chain
any more: no `~/.hasna/fleet-env`, no `~/.hasna/cloud`, no `~/.config/hasna`,
no `HASNA_MESSAGES_LOCAL_MODE_ENV` switch, no deprecation notice. The ladder:

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

## Development

```bash
bun install
bun run test        # domain + CLI + HTTP surface tests (SQLite in-memory / temp file)
bun run typecheck
bun run contract-check   # manifest conformance via @hasna/contracts
bun run build       # dist/ (sdk + index) and bin/ (CLI, MCP, serve)
bun run test:postgres   # live PostgreSQL proof gate (MESSAGES_TEST_DATABASE_URL)
```

## License

Apache-2.0
