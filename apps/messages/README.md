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

The client (CLI / MCP / SDK) talks to the server's HTTP API
(`HASNA_MESSAGES_API_URL` + `HASNA_MESSAGES_API_KEY`) or to a local store —
it never opens Postgres directly. `messages-serve` supports a trusted
localhost mode with no key configured; when a key is configured, requests
must carry it as `x-api-key`.

## Usage

```bash
# Local, no server needed:
messages register --name augustus --display-name "CEO seat"
messages send --from augustus --to silvanus --content "hello"
messages threads --agent silvanus           # unread counts + closed state
messages thread --id t_augustus__silvanus --agent silvanus   # expand (does not mark read)
messages receive --agent silvanus           # drain: stored -> delivered
messages delivery --id t_augustus__silvanus # per-recipient state: stored | delivered | read
messages read --id t_augustus__silvanus --agent silvanus     # -> read
messages close --id t_augustus__silvanus --agent silvanus    # close (excluded from default list)
messages reopen --id t_augustus__silvanus --agent silvanus   # reopen
messages unread --agent silvanus            # unread threads + total

# Against a running messages-serve:
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
