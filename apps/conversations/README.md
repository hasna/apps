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
conversations project list --page-json --limit 100 --cursor 0
```

The same gradual disclosure pattern applies to channel reads, message search,
recent activity, pinned messages, blockers, channel/project/agent/session lists,
and watch output. Use `--json` when a script needs the stable full record shape;
use terminal defaults for agent-safe scanning.

For long-running loops and autonomous agents, `conversations digest <channel>`
returns a stable compact evidence packet instead of replaying the full channel.
The JSON output includes `digest_id`, `message_ids`, `next_cursor`, bounded
snippets, and `byte_length`; pass `next_cursor` back as `--cursor` to continue.

`project list --json` retains its legacy bare-array output. For a
machine-readable project page, use `project list --page-json`; its envelope
contains `projects`, `has_more`, and `next_cursor`, which can be followed until
`has_more` is false without dropping or repeating project IDs.
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

## Agent Identity

Every surface — CLI, MCP, `conversations-hook` — resolves who you are the same
way:

1. an explicit `--from` / `from` argument,
2. the `CONVERSATIONS_AGENT_ID` env var,
3. the agent that registered on this MCP connection (stdio only, see below),
4. the identity registered for `CONVERSATIONS_SESSION_ID`, stored in a
   session-keyed file under the data home (`session-identities/` — legacy
   `~/.hasna/conversations/session-identities/`),
5. this installation's identity, the data home's `agent-id` (legacy
   `~/.hasna/conversations/agent-id`) — **only when the process opts in with
   `CONVERSATIONS_USE_MACHINE_IDENTITY=1`**.

**There is no sixth rung. A session that declares nothing gets an error, not a
name.** Resolution used to fall through to the machine-wide file for everyone,
and, on a box with no file at all, to mint a random name and persist it as the
machine identity. Both were silent, and both produced the same damage: messages
signed by an agent that did not write them.

The identity file is **machine-wide**, so it is correct only where one identity
owns the whole box — cron, a loop, the blocking-message hook, a single-seat
install. Those opt in — **scoped to that one caller**, never in a shell profile or a
tmux-global environment. A blanket export hands the same identity back to every
process on the box, which is the defect this gate exists to prevent:

```bash
# in the crontab line, the loop's env block, or the hook's wrapper — not ~/.zshrc
CONVERSATIONS_USE_MACHINE_IDENTITY=1 conversations read --blocking
```

Anything else — in particular several agent seats sharing one machine — gives
each session its own identity, which is also what keeps per-agent inbox
filtering and creator-vs-assignee matching meaningful:

```bash
export CONVERSATIONS_AGENT_ID=agent-harness   # per seat, survives restarts
```

Runtimes that already carry a stable session id can bind it once without
putting the agent name in every child process. `agents register` uses
`CONVERSATIONS_SESSION_ID` as the presence session id and writes only that
session's hashed identity record. Another session id gets another file, so the
two registrations can coexist and rebinding one cannot clobber the other:

```bash
export CONVERSATIONS_SESSION_ID=codewith-run-123
conversations agents register agent-harness
conversations whoami --json   # agent-harness; source names CONVERSATIONS_SESSION_ID
```

`--session <id>` creates the same binding explicitly. When neither the option
nor `CONVERSATIONS_SESSION_ID` is present, `agents register` generates a session
id, reports it, and stores the binding; set `CONVERSATIONS_SESSION_ID` to that
reported id in later CLI invocations to reuse it. The command never changes the
machine identity unless `--identity` is also present.

Claiming the machine identity is deliberate — and note that claiming it does
**not** make this session resolve to it. Writing the file and reading the file
are separate decisions on purpose, so a seat can set the box's identity without
handing itself, or anyone else, an identity it never declared:

```bash
conversations agents register augustus --identity    # claim the box as "augustus"
conversations whoami --json                          # still refuses: nothing declared for THIS session
CONVERSATIONS_USE_MACHINE_IDENTITY=1 conversations whoami --json   # now resolves to augustus
```

`whoami` exits non-zero and reports `code: "IDENTITY_NOT_SET"` when nothing
declared an identity, naming the identity it refused to borrow.

Two things also write it, and nothing else does:

- `conversations agents rename <old> <new>` follows the rename when the renamed
  agent *is* this installation's identity.
- On a box with **no** identity file at all, the first MCP `register_agent`
  claims it. Seed-if-absent, never last-writer-wins — an identity that already
  exists is left alone.

Session identity files are separate from that installation-wide file. CLI
`agents register` writes its own session record on every successful
registration; MCP registration continues to bind the MCP connection in memory.
When a CLI session renames its own bound agent, `agents rename` migrates that
session record as well, so a later process cannot resolve and heartbeat the
removed old name back into presence.

**Migrating from ≤ 0.5.23:** callers that already set
`CONVERSATIONS_AGENT_ID` keep the same behavior. Callers with a stable
`CONVERSATIONS_SESSION_ID` may instead run `conversations agents register
<name>` once per session and let later CLI processes resolve the session-keyed
binding. Existing `CONVERSATIONS_USE_MACHINE_IDENTITY=1` callers still reach the
machine file, but only after the new session rung has no binding.

**Migrating from ≤ 0.5.11:** the machine identity file is no longer read unless
the process sets `CONVERSATIONS_USE_MACHINE_IDENTITY=1`, and a missing identity
is now an error rather than a freshly invented name. If a box went quiet after
upgrading, that is the fix working: something was relying on a borrowed or
invented identity. Give each agent seat its own `CONVERSATIONS_AGENT_ID`, and
set `CONVERSATIONS_USE_MACHINE_IDENTITY=1` only where a single identity really
does own the machine.

**Migrating from ≤ 0.5.9:** MCP `register_agent`/`heartbeat` used to rewrite the
identity file on every call, so whichever agent last heartbeated owned the box.
They no longer do. If a shared machine was relying on that to pick up its name,
claim it once with `conversations agents register <name> --identity`, or export
`CONVERSATIONS_AGENT_ID`. Run `conversations whoami --json` to check.

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

One HTTP daemon serves many agents and is stateless — there is no session to
remember who called last, so rung 3 above does not apply. Agents sharing an HTTP
daemon must pass `from` explicitly on every write, or run their own process with
`CONVERSATIONS_AGENT_ID` set. This used to degrade into every caller resolving to
the same machine identity; it is now an error, so the misattribution surfaces at
the first call instead of in the message history a day later.

## HTTP API (`conversations-serve`)

`conversations-serve` is the server HTTP API surface. Every read and write goes
straight to the app's Postgres selected by `HASNA_CONVERSATIONS_DATABASE_URL`
via the vendored `@hasna/contracts` storage kit (the server backend switch is
`sqlite | postgresql`; this process serves the postgresql backend). Requests to
`/v1/*` are authenticated with `@hasna/contracts` API keys (scope grammar
`conversations:read` / `conversations:write`).

```bash
# the app DSN for the postgresql backend (generate/rotate per deployment)
export HASNA_CONVERSATIONS_DATABASE_URL=<your-postgres-dsn>
# generate the signing secret once, e.g. with: openssl rand -hex 32
export HASNA_CONVERSATIONS_API_SIGNING_KEY=<your-random-hex>
conversations-serve                     # listens on :8080 (PORT/HOST configurable)

# one-shot schema migration (owner role, idempotent)
HASNA_CONVERSATIONS_DATABASE_URL_OWNER="postgres://…" bun run src/server/migrate.ts
```

Endpoints:

- Successful `GET /health` · `GET /ready` → `{status, version, app}`; `GET /version` also returns `build_sha` (unauthenticated probes)
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

The local SQLite store and per-install files (config, agent identity, exports,
attachments, training) are resolved through the `@hasna/paths` resolver (XDG /
macOS home layout). The legacy `~/.hasna/conversations/` data root stays the
effective root until the store has been migrated to the resolver data home
(`~/.local/share/hasna/conversations` on Linux) or the operator sets the
data-kind override `HASNA_DATA_HOME`. An explicit store path
(`HASNA_CONVERSATIONS_DB_PATH` / `CONVERSATIONS_DB_PATH`) always wins; the
exact-app overrides `HASNA_CONVERSATIONS_HOME` / `CONVERSATIONS_HOME` name an
explicit data root.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
