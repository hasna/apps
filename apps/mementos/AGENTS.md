# AGENTS.md — @hasna/mementos for AI Agents

This document explains how AI agents (Claude, Codex, Cursor, Gemini, custom) should use `@hasna/mementos` for persistent memory.

## Quick Setup

```
# 1. Install the stdio MCP server in a command-based agent host
claude mcp add --transport stdio --scope user mementos -- mementos-mcp --stdio
# Codex config: command = "mementos-mcp", args = ["--stdio"]
# Cursor config: command = "mementos-mcp", args = ["--stdio"]

# 2. Start REST server (optional — for SDK/HTTP access)
mementos-serve --port 19428  # Default port
```

`mementos-mcp` with no arguments starts Streamable HTTP on
`127.0.0.1:8867`; command-based MCP hosts must pass `--stdio`.

## Session Start Protocol

Run at the beginning of every agent session:

```
1. register_agent(name="<your-roman-name>", role="<role>")
2. register_project(name="<git-repo-name>", path="<absolute-path>")
3. update_agent(id="<your-name>", active_project_id="<project-uuid>")  -- bind to project
4. memory_inject(project_id="<id>", format="compact", max_tokens=400)  -- load context
```

## During Work

Save memories immediately when:
- User corrects you → importance 9-10
- You learn something unexpected → importance 7-8
- You make an architectural decision → importance 8-9
- You finish a task → importance 5-7

```
memory_save(
  key="<descriptive-kebab-key>",
  value="<what + why it matters>",
  category="knowledge",     # preference | fact | knowledge | history | procedural | resource
  scope="shared",           # global | shared | private
  importance=8,
  agent_id="<your-id>",
  project_id="<project-id>",
  session_id="<current-session>"
)
```

## Compact Output Defaults

The CLI and MCP tools are compact by default to keep agent context small.

- `mementos list`, `search`, `history`, `stale`, and other list/status commands
  show capped rows, truncated text, and a hint for the next page.
- Use `--limit` and `--cursor`/`--offset` to page through compact output.
- Use `--verbose` when a command supports it to show wider snippets or match
  highlights.
- Use `mementos show <id>` or targeted recall/get tools for full detail.
- Use `--json` for stable CLI object output; MCP tools that can dump complete
  objects expose `full=true` or `format="json"`.

## Session End Protocol

```
1. session_extract(session_id="<id>", title="...", key_topics=[...], project_id="...")
2. memory_save(key="session-<date>-summary", category="history", ...)
```

## MCP Tool Profiles

`mementos-mcp` defaults to the bounded `core` profile (23 tools). Configure an
additive comma-separated profile list with `--mcp-profile`,
`HASNA_MEMENTOS_MCP_PROFILE`, or the compatibility alias
`MEMENTOS_MCP_PROFILE`:

- `core` — common save/recall/get/list/update, primary search and context,
  lifecycle, agent/project identity, focus, and discovery tools;
- `search` — advanced search, history, health, activity, report, and audit reads;
- `graph` — entity, relation, traversal, dependency-graph, and tool-insight tools;
- `automation` — synthesis, auto-memory, auto-inject, sessions, consolidation,
  and reflection;
- `admin` — fleet registries, bulk operations, locks, import/export, ACL, GDPR,
  audit, and eviction;
- `storage` — storage status, sync, and migration operations;
- `hooks` — hooks, webhooks, subscriptions, tool events, and feedback;
- `full` — compatibility profile exposing all 123 tools and the three legacy
  unpaged resources.

Every reduced profile includes `core`, and profiles compose:

```bash
mementos-mcp --stdio                         # core
mementos-mcp --stdio --mcp-profile search,graph # core + search + graph
HASNA_MEMENTOS_MCP_PROFILE=full mementos-mcp --stdio
```

Unknown profile names safely fall back to `core`; they never widen access to
`full`. Reduced profiles omit `mementos://memories`, `mementos://agents`, and
`mementos://projects`; use bounded list/get tools instead. `search_tools`
returns a bounded names-only page for the active profile, while
`describe_tools` requires one to ten explicit tool names.

## Token Optimization

**Critical**: use `format="compact"` on `memory_inject` — saves ~60% tokens.

| Format | Output | Size |
|--------|--------|------|
| `compact` | `key: value` | Smallest (~60% less than xml) |
| `xml` | `<agent-memories>` wrapped | Default, backward compat |
| `markdown` | `## Agent Memories` | Human-readable |
| `json` | JSON array | Machine processing |

## Key Naming Convention

```
project-stack          -- project facts
learning-<topic>       -- discovered patterns
correction-<topic>     -- mistakes + right approach (importance 10)
session-<id>-summary   -- session history
agent-workflow-<name>  -- process knowledge
```

## Memory Scopes

| Scope | Visible To | When |
|-------|-----------|------|
| `global` | ALL agents, all projects | Universal truths, user preferences |
| `shared` | All agents on this project | Project decisions, conventions |
| `private` | Only this agent session | Drafts, per-session notes |
| `working` | Current agent/session scratchpad | Transient work; defaults to a one-hour TTL |

**Default to `shared`** for most memories — other agents on the project benefit.

## Cross-Project Integrations

| Tool | Integration |
|------|------------|
| **@hasna/sessions** | `session_extract()` after session ingest → auto-save learnings |
| **@hasna/todos** | Include `session_id` in memory_save when working on a task |
| **@hasna/attachments** | Store attachment IDs as memory values |
| **@hasna/conversations** | `update_agent(active_project_id)` → mementos as agent registry |
| **@hasna/instructions** | `memory_inject()` for context; config decisions as `fact` memories |

## Common Patterns

### Pattern: correction memory (highest priority)
When user says "that's wrong, it should be X":
```
memory_save(key="correction-<topic>", value="WRONG: <what>. CORRECT: <fix>. WHY: <reason>", importance=10, scope="shared")
```

### Pattern: version-free updates (no 2-round-trips needed)
```
memory_update(id="<id>", importance=9)           -- version auto-fetched
memory_pin(key="project-stack")                  -- no version needed
memory_archive(key="old-pattern")                -- no version needed
```

### Pattern: query session learnings
```
GET /api/memories?session_id=<id>                -- everything this session produced
memory_list(session_id="<id>")                   -- same via MCP
```

### Pattern: who's on a project
```
list_agents_by_project(project_id="<id>")        -- active agents for a project
GET /api/projects/<name>/agents                  -- same via REST
GET /api/agents?project_id=<id>                  -- same via REST
```

### Pattern: daily activity trend
```
memory_activity(days=7, project_id="<id>")       -- how fast is the agent learning?
GET /api/activity?days=14                         -- same via REST
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `HASNA_MEMENTOS_DB_PATH` / `MEMENTOS_DB_PATH` | Explicit local SQLite file — the precedence-1 local opt-in | `~/.hasna/mementos/mementos.db` |
| `HASNA_MEMENTOS_LOCAL` / `MEMENTOS_LOCAL` | Deliberate unhosted opt-in (honoured only when nothing configures an authority) | unset |
| `MEMENTOS_DB_SCOPE` | `project` = use git root DB | global |
| `MEMENTOS_HOST` | Server bind address | `127.0.0.1` |
| `HASNA_MEMENTOS_API_KEY` | Hosted credential, tier 5 (below Keychain + `~/.hasna/mementos/config/credentials`); a key alone resolves to `https://api.hasna.com/mementos` | none |
| `HASNA_MEMENTOS_API_URL` | Hosted authority override; the Keychain `api-url` item, the credentials file, then the fleet gateway otherwise | fleet gateway |
| `HASNA_STATION` | Keychain account for `hasna.credentials.mementos.api-key` (hostname/`USER` fallbacks) | hostname |
| `HASNA_MEMENTOS_API_KEY_OVERRIDE` / `HASNA_MEMENTOS_API_KEY_REF` / `HASNA_PROFILE` | Deliberate env pointer / vault pointer / profile — tiers above the Keychain | none |
| `HASNA_MEMENTOS_DATABASE_URL` | Server-only PostgreSQL URL; presence selects the server postgresql backend | none |

Hosted clients (CLI, MCP server, `./sdk`) resolve through the ONE
`@hasna/contracts` chain, fresh per call; retired `*_MODE` / `*_STORAGE_MODE`
variables and the retired locations (`~/.hasna/fleet-env/`, `~/.hasna/cloud/`,
`~/.config/hasna/`) are inputs nowhere.

## Ports

Default REST server port: **19428**

Default MCP Streamable HTTP port: **8867**

```
# default REST server port: 19428 (SDK clients: pass an explicit baseUrl,
# or rely on the unhosted default — the SDK no longer reads MEMENTOS_URL)
```

## Constraints

- Memory keys are unique per (key, scope, agent_id, project_id, session_id)
- Duplicate keys with same scope → **upsert** (value updated, version incremented)
- `version` field in `memory_update` is **optional** — auto-fetched if not provided
- Expired memories are hidden but not deleted until `clean_expired` is called
- Max 365 days in `memory_activity` query
- `memory_inject` token budget: 500 tokens default, `max_tokens` param to override
