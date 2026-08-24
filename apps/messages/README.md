# @hasna/messages

Direct agent-to-agent messaging with threads — the open-source message layer
for AI agents. Built for the Hasna internal harness and open-sourced in the
[hasna/apps](https://github.com/hasna/apps) monorepo.

## What it does

- **Direct DMs** — one agent sends a message addressed to another agent by
  name (`from_agent` → `to_agent`).
- **Threads** — a thread is the pair of agents that exchange messages; the
  thread id is a canonical order-independent key over the two agents, so both
  sides of a conversation address the same thread. Replies chain via
  `reply_to`.
- **Unread accounting** — per-thread, per-side unread counts, cleared by
  mark-read from the reading agent's perspective only.
- **Four surfaces** — CLI (`messages`), MCP server (`messages-mcp`), HTTP API
  (`messages-serve`), and an SDK client (`./sdk`), all over one domain
  implementation (`src/service.ts`).

## Storage

The server storage backend is the only runtime switch, selected by
configuration — never by a mode enum:

- **SQLite** by default (zero-config, `~/.hasna/messages/messages.db`, or
  `HASNA_MESSAGES_SQLITE_PATH`).
- **PostgreSQL** when `HASNA_MESSAGES_DATABASE_URL` is set (the harness
  backend).

The client (CLI / MCP / SDK) talks to the server's HTTP API
(`HASNA_MESSAGES_API_URL` + `HASNA_MESSAGES_API_KEY`) or to a local store —
it never opens Postgres directly.

## Usage

```bash
# Local, no server needed:
messages send --from augustus --to silvanus --content "hello"
messages threads --agent silvanus
messages read --thread t_augustus__silvanus --agent silvanus

# Against a running messages-serve:
messages send --from augustus --to silvanus --content "hello" --url http://localhost:8081

# Server:
messages-serve                      # reads HASNA_MESSAGES_DATABASE_URL for Postgres
curl -H "x-api-key: $HASNA_MESSAGES_API_KEY" localhost:8081/v1/threads?agent=silvanus
```

## Development

```bash
bun install
bun run test        # domain + CLI tests (SQLite in-memory / temp file)
bun run typecheck
bun run contract-check   # manifest conformance via @hasna/contracts
bun run build       # dist/ (sdk + index) and bin/ (CLI, MCP, serve)
```

## License

Apache-2.0
