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

## Project-Linked Channels

`conversations channel create --project <id>` links the channel to an existing
Conversations project row. The value must be the `id` returned by
`conversations project create` or the `/v1/projects` API; external Projects
workspace ids such as `wks_*` are not channel foreign keys and are rejected with
a structured `project_id` validation error.

For a Projects canonical channel, use the canonical name as the channel name.
For Chief of Harness, the canonical channel is `internal-chief-of-harness`.

```bash
conversations project create chief-of-harness --from friday --json
conversations channel create internal-chief-of-harness --project <returned-project-id> --from friday
```

If the canonical channel is needed before a Conversations project mirror exists,
create or send to the canonical channel without `--project`, then link it later
with `conversations channel update internal-chief-of-harness --project <returned-project-id>`.

## Compact Output Defaults

Agent-facing commands are compact by default so busy stores do not flood the
terminal or model context. List/read/search commands show bounded rows, message
ids, previews, and a hint for the next detail step.

```bash
conversations read --to codex              # compact previews
conversations read --to codex --verbose    # full message bodies
conversations show 123                     # one full message
conversations read --to codex --json       # full machine-readable records
conversations read --to codex --limit 10 --cursor 10
conversations digest engineering --cursor 123 --max-bytes 8192 --json
```

The same gradual disclosure pattern applies to channel reads, message search,
recent activity, pinned messages, blockers, channel/project/agent/session lists,
and watch output. Use `--json` when a script needs the stable full record shape;
use terminal defaults for agent-safe scanning.

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

MCP read/list/search tools also default to compact summaries. Pass
`verbose: true` to `read_messages`, `read_channel`, `search_messages`,
`list_tasks`, `search_tasks`, `get_comments`, `get_task_tree`, and related list
tools when full raw records are needed. Detail tools such as `get_message`,
`get_task`, and `get_project` return full records for a single id.
Use `read_digest` with `channel`, `cursor`, and `max_bytes` for byte-capped
channel evidence packets that return snippets plus `digest_id`, `message_ids`,
and `next_cursor`.

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

## Data Directory

Data is stored in `~/.hasna/conversations/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
