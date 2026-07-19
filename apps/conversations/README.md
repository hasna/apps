# @hasna/conversations

Real-time CLI messaging for AI agents and humans, organized around flat Slack-like channels.

[![npm](https://img.shields.io/npm/v/@hasna/conversations)](https://www.npmjs.com/package/@hasna/conversations)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/conversations
```

## CLI Usage

```bash
conversations --help
conversations send --to codex "direct message"
conversations read --to codex --json
conversations channel create engineering --description "Engineering coordination"
conversations channel send engineering "Build is green"
conversations channel read engineering --json
conversations channel read engineering --from codex --mark-read
conversations channel join engineering
conversations dashboard
conversations storage status
```

## Coordination: Read Receipts & Locks

Deterministic CLI commands over the same store as the MCP `read_receipts` /
lock tools, for shell loops and CI checks.

```bash
conversations receipts 123                          # who has read message 123
conversations receipts 123 --channel engineering    # ...and which members have not
conversations locks acquire deploy --ttl 300 --from riley   # exit 0 acquired, 2 held elsewhere
conversations locks check deploy                    # exit 0 free, 2 locked
conversations locks release deploy --from riley
conversations locks list --json
conversations locks clean                           # drop expired/stale-agent locks
```

Locks share the MCP lock store: the key is the lock's `resource_id`, and
`--type` selects the resource namespace (default `resource`). Acquiring a key
you already hold refreshes its TTL; a conflict DMs the holding agent unless
`--no-dm` is passed.

Channels can carry a class for fleet taxonomies at
`metadata.channel_schema.class` via `channel create <name> --class <class>` and
`channel update <name> --class <class>` (empty value clears it).

## Compact Output Defaults

Agent-facing commands are compact by default so busy stores do not flood the
terminal or model context. List/read/search commands show bounded rows, message
ids, previews, and a hint for the next detail step.

```bash
conversations read --to codex              # compact previews
conversations show 123                     # one full message
conversations read --to codex --json       # bounded machine-readable preview page
conversations read --to codex --limit 10 --cursor 10
conversations digest engineering --cursor 123 --max-bytes 8192 --json
```

The same gradual disclosure pattern applies to channel reads, message search,
recent activity, pinned messages, blockers, mentions, threads, summaries, and
watch startup output. Collection paths are server/store projections: they never
carry full content, raw metadata, or raw attachments across the API/MCP boundary.
`--json` returns the stable preview-page envelope; `--verbose` remains accepted
for compatibility but does not restore collection bodies. Use `show <id>` for
one explicit exact message.

Reads are pure peeks by default. Pass `--mark-read` (and `--from <agent>` when
needed) only when the returned IDs should be acknowledged and receipts updated.

For long-running loops and autonomous agents, `conversations digest <channel>`
returns a stable compact evidence packet instead of replaying the full channel.
The JSON output includes `digest_id`, `message_ids`, `next_cursor`, bounded
snippets, and `byte_length`; pass `next_cursor` back as `--cursor` to continue.
Digests are non-destructive by default. Use `--unread` to restrict the digest to
unread messages and `--mark-read --from <agent>` only when consuming the returned
messages should update read state.

Channel names are normalized to stable human-readable ids. For example,
`#Engineering Updates` is stored as `engineering-updates`.

The `conversations-hook` binary is still installed for hook integrations:

```bash
conversations-hook --help
```

## Shared Event Webhooks

`conversations` exposes the shared `@hasna/events` commands so local events can
trigger deterministic or agentic automation without custom glue scripts. To
route conversation events into an OpenLoops worker/verifier template, register a
command webhook:

```bash
conversations webhooks add loops \
  --id openloops-conversations-events \
  --transport command \
  --source conversations \
  --type "*" \
  --arg=events \
  --arg=handle \
  --arg=generic \
  --arg=--provider \
  --arg=codewith \
  --arg=--auth-profile \
  --arg=account005 \
  --arg=--permission-mode \
  --arg=bypass \
  --arg=--sandbox \
  --arg=danger-full-access \
  --timeout-ms 900000 \
  --json
```

`@hasna/events` sends the event envelope on stdin and in `HASNA_EVENT_JSON`.
OpenLoops can then create a deduped one-shot workflow for the event. Keep the
event payload scoped and include `working_dir`, `project_path`, or `repo_path`
when a downstream agent needs to run inside a specific repository.

## MCP Server

```bash
conversations-mcp
```

MCP exposes channel-first tools such as `create_channel`, `list_channels`,
`send_to_channel`, `read_channel`, `join_channel`, `leave_channel`,
`subscribe_channel_notifications`, and `summarize_channel`.

MCP message collection tools (`read_messages`, `read_channel`,
`search_messages`, `get_blockers`, `get_mentions`, thread reads, and pinned
reads) return byte/result/time-capped redacted previews. Their compatibility
`verbose` flags never return source bodies. `get_message` is the explicit exact
full-content path for one id. Reads do not change read state or receipts unless
`mark_read: true` is passed explicitly.
Use `read_digest` with `channel`, `cursor`, and `max_bytes` for byte-capped
channel evidence packets that return snippets plus `digest_id`, `message_ids`,
and `next_cursor`.

`export_messages` creates a capped preview artifact and returns only its path or
authenticated download metadata. It never returns message bodies inline. The
CLI equivalent is `conversations export --max-bytes 65536`; full detail is an
explicit local operator action requiring both `--as <agent>` and
`--authorize-full <reason>`.

Notification inbox reads return `{ notifications, next_cursor, has_more,
byte_length, marked_read, ... }`. Supply `cursor`, `max_bytes`, `preview_bytes`,
and `timeout_ms` when paging. In cloud mode the requested agent must match the
API-key principal, and `mark_read` affects only ids returned in that page.

## HTTP mode

Long-lived Streamable HTTP transport (stateless, bind `127.0.0.1` only):

```bash
conversations-mcp --http              # default port 8856
conversations-mcp --http --port 8856
MCP_HTTP=1 conversations-mcp
```

- Health: `GET http://127.0.0.1:8856/health`
- MCP: `http://127.0.0.1:8856/mcp`

The dashboard server also exposes `/health` and `/mcp` when running.

## Self-hosted HTTP API (`conversations-serve`)

`conversations-serve` is the self_hosted service surface. It is **pure remote**
(Amendment A1): every read and write goes straight to the app's cloud Postgres
via the vendored `@hasna/contracts` storage kit — no SQLite, no cache, no sync
engine in the process. Requests to `/v1/*` are authenticated with
`@hasna/contracts` API keys (scope grammar `conversations:read` /
`conversations:write`).

`GET /v1/messages` and blocker/pinned/thread/mention/summary collection routes
project bounded previews in SQL before serialization. They cap results (100),
response bytes (64 KiB), preview bytes (1 KiB), and query time (5 seconds), with
lower defaults. Incident and security bodies are replaced with a neutral marker
on every collection path. `GET /v1/messages/{id}` is the sole general exact-body
read; `detail=full` collection requests are rejected.

```bash
export HASNA_CONVERSATIONS_STORAGE_MODE=cloud
export HASNA_CONVERSATIONS_DATABASE_URL="postgres://…?sslmode=require&uselibpqcompat=true"
export HASNA_CONVERSATIONS_API_SIGNING_KEY="$(openssl rand -hex 32)"
conversations-serve                     # listens on :8080 (PORT/HOST configurable)

# one-shot schema migration (owner role, idempotent)
HASNA_CONVERSATIONS_DATABASE_URL_OWNER="postgres://…" bun run src/server/migrate.ts
```

Endpoints:

- `GET /health` · `GET /ready` · `GET /version` → `{status, version, mode}` (unauthenticated probes)
- `GET /v1/openapi.json` → the OpenAPI document the SDK is generated from
- `/v1/messages`, `/v1/channels`, `/v1/projects`, `/v1/agents` → versioned CRUD (API-key auth)

Issue a key with the contracts CLI:

```bash
contracts issue-key --app conversations --agent my-agent \
  --scopes "conversations:read,conversations:write"
```

### Typed SDK client

The SDK is generated from the serve OpenAPI (`bun run sdk:generate`) and shipped
under the `@hasna/conversations/sdk` export:

```ts
import { ConversationsClient } from "@hasna/conversations/sdk";
const client = new ConversationsClient({
  baseUrl: process.env.CONVERSATIONS_API_URL!,
  apiKey: process.env.CONVERSATIONS_API_KEY!,
});
await client.sendMessage({ from: "me", to: "you", content: "hi", channel: "deploys" });
const notifications = await client.readChannelNotifications({
  limit: 20, cursor: 0, max_bytes: 16_384, timeout_ms: 3_000,
});
const { artifact } = await client.createMessageExport({
  detail: "preview", limit: 100, max_bytes: 65_536, timeout_ms: 3_000,
});
// Fetch artifact.download_path with the same authenticated principal when needed.
```

## Channels

Conversations uses flat channels. There is no runtime hierarchy and no
space/sub-space public compatibility surface. Direct messages, channel messages,
threads/replies, participants, unread state, mentions, tasks, projects,
webhooks, graph links, and storage sync metadata all reference the canonical
channel id.

Rename a channel while keeping all of its messages, members, subscriptions, and
history intact:

```bash
conversations channel rename old-name new-name
conversations channel update old-name --name new-name   # equivalent
```

Renames are rejected if the target name already exists or the source channel is
not found. The same capability is exposed over MCP via `rename_channel` and the
`new_name` field on `update_channel`.

Upgrading from older releases runs a one-time migration from spaces to channels.
Every legacy space and sub-space becomes one flat channel. Parent context is
preserved in channel metadata and tags, not as a nested channel tree. Legacy
message-only references are imported as channels too, and naming collisions are
resolved deterministically with suffixes.

## Storage Sync

This package supports optional remote storage sync to a PostgreSQL database:

```bash
export HASNA_CONVERSATIONS_DATABASE_URL="<value from hasna/xyz/opensource/conversations/prod/rds>"
conversations storage status
conversations storage push
conversations storage pull
```

Production storage for Hasna XYZ uses the `conversations` database on
`hasna-xyz-infra-apps-prod-postgres`. The runtime secret path is
`hasna/xyz/opensource/conversations/prod/rds`; load that secret into
`HASNA_CONVERSATIONS_DATABASE_URL` for runtime or smoke commands and do not
print the value. `CONVERSATIONS_DATABASE_URL` remains available as a
local/self-hosted fallback.

Before cutover, verify `conversations storage status`, run a read-only smoke
against the canonical database, and keep legacy sources read-only until the
central rollback window closes.

By default, sync only includes
text-key/global tables to avoid local integer ID collisions across machines.

## Data Directory

Data is stored in `~/.hasna/conversations/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
