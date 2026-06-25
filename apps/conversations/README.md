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
```

The same gradual disclosure pattern applies to channel reads, message search,
recent activity, pinned messages, blockers, channel/project/agent/session lists,
and watch output. Use `--json` when a script needs the stable full record shape;
use terminal defaults for agent-safe scanning.

Channel names are normalized to stable human-readable ids. For example,
`#Engineering Updates` is stored as `engineering-updates`.

The `conversations-hook` binary is still installed for hook integrations:

```bash
conversations-hook --help
```

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

## Channels

Conversations uses flat channels. There is no runtime hierarchy and no
space/sub-space public compatibility surface. Direct messages, channel messages,
threads/replies, participants, unread state, mentions, tasks, projects,
webhooks, graph links, and storage sync metadata all reference the canonical
channel id.

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
