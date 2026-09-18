# MCP reference

`mementos-mcp` exposes the memory system through the Model Context Protocol.
The default `core` profile registers 23 bounded agent tools. The explicit `full`
profile preserves all 124 tools and three legacy resources from the live source
tree.

## Transport modes

Streamable HTTP is the default:

```bash
mementos-mcp
mementos-mcp --http
MCP_HTTP_PORT=9000 mementos-mcp
```

It binds only to `127.0.0.1`. The default port is 8867, `POST /mcp` is the MCP
endpoint, and `GET /health` returns the service liveness response. `--port`
overrides `MCP_HTTP_PORT`.

Stdio is opt-in:

```bash
mementos-mcp --stdio
# or
MCP_STDIO=1 mementos-mcp
```

Command-based MCP host configuration must include `--stdio`; launching
`mementos-mcp` with no arguments starts HTTP and will not speak MCP on stdin.
The default profile is `core`. Select one or more additive profiles with
`--mcp-profile search,graph`, `HASNA_MEMENTOS_MCP_PROFILE`, or the compatibility
alias `MEMENTOS_MCP_PROFILE`. Unknown profile names fall back to `core`, never
to the full administrative surface. For example:

```bash
claude mcp add --transport stdio --scope user mementos -- mementos-mcp --stdio
```

```toml
[mcp_servers.mementos]
command = "mementos-mcp"
args = ["--stdio"]
```

The `mementos mcp` CLI command manages Claude, Codex, and Gemini config files.
Because transport defaults changed to HTTP, inspect command-based entries it
creates and ensure their argument list contains `--stdio`.

## Runtime behavior

Before serving, the entry point performs best-effort startup checks, loads
persisted webhook hooks, and ensures the local REST service is available.
Stdio mode also starts contextual auto-injection and advertises the experimental
`claude/channel` capability. HTTP mode creates a stateless MCP server/transport
for each request and supports concurrent clients in one process.

Storage selection is shared with the CLI: the hosted transport resolves
through the ONE `@hasna/contracts` credential chain (fresh per request —
`HASNA_MEMENTOS_API_KEY`, the macOS Keychain item
`hasna.credentials.mementos.api-key`, or `~/.hasna/mementos/config/credentials`,
with the authority defaulting to the fleet gateway `https://api.hasna.com/mementos`);
the on-box SQLite store is reachable only through the explicit local opt-ins
(`HASNA_MEMENTOS_DB_PATH` / `HASNA_MEMENTOS_LOCAL=1`), and a local server says
so on stderr at startup. Raw PostgreSQL database URLs belong only on
`mementos-serve` or an explicit administrative migration path.

See [Configuration and storage](CONFIGURATION.md).

## Output conventions

List and status tools generally return compact text by default. The exact
controls are part of each schema, but common arguments are:

- `limit` and `offset` for paging;
- `verbose` for wider text;
- `full: true` for complete objects;
- `format: "json"` where the tool advertises a format argument.

`memory_inject` supports `xml`, `markdown`, `compact`, and `json`. It also
supports default or smart selection, full or hint output, task activation, and
machine visibility. `compact` is the smallest prompt-ready format; hint mode
returns topic/count summaries which can be followed by targeted
`memory_recall` calls.

MCP `tools/list` is authoritative for all names and Zod-derived input schemas.
The convenience `search_tools` tool searches the active profile and returns a
bounded JSON page containing names only. `describe_tools` requires one to ten
explicit active-profile names; omitting `names` can no longer dump the complete
catalog.

`memory_list(full=true)` is also bounded. It returns minified JSON with `items`
and truthful `_meta` fields (`count`, `limit`, `offset`, `next_offset`,
`has_more`, `complete`, and `truncated`) instead of a bare array whose coverage
cannot be determined. Full pages default to a 65,536-byte ceiling (override with
`max_bytes`, up to 1 MiB). If one record cannot fit, `_meta.blocked_item_id`
directs the caller to `memory_get` or a narrower `fields` projection.

This is an intentional response-shape change. Migrate consumers from:

```javascript
const memories = JSON.parse(text)
```

to:

```javascript
const { items: memories, _meta } = JSON.parse(text)
if (_meta.has_more && _meta.next_offset !== null) {
  // call memory_list again with offset: _meta.next_offset
}
```

## MCP profiles

Every reduced profile includes `core`; comma-separated profile names compose.
Use `full` only for compatibility or broad administration.

| Profile | Purpose |
| --- | --- |
| `core` | 23 common memory, context, focus, agent/project identity, and discovery tools; default |
| `search` | history, advanced search, health, audit-read, activity, and report tools |
| `graph` | entities, relations, graph traversal, file dependency graph, and tool insights |
| `automation` | synthesis, auto-memory, auto-inject, session extraction, consolidation, and reflection |
| `admin` | fleet registries, bulk operations, locks, import/export, ACL, GDPR, audit and eviction tools |
| `storage` | storage status/sync/migration tools, including PostgreSQL migration |
| `hooks` | hooks, webhooks, subscriptions, tool events, and feedback |
| `full` | all 124 tools plus the three legacy unpaged resources |

The legacy `mementos://memories`, `mementos://agents`, and
`mementos://projects` resources are registered only in `full`. Reduced profiles
use bounded tools such as `memory_list`, `memory_get`, `list_agents`, and
`list_projects`, preventing a resource read from injecting up to 1,000 complete
memory objects into agent context.

## Full-profile tool inventory

### Core memories (30)

```text
memory_save
memory_recall
memory_get
memory_list
memory_update
memory_versions
memory_diff
memory_chain_get
memory_health
memory_check_contradiction
memory_invalidate
memory_search
memory_search_semantic
memory_search_hybrid
memory_search_bm25
memory_recall_deep
memory_pin
memory_archive
memory_forget
memory_stale
memory_flag
memory_stats
memory_activity
memory_report
memory_audit_trail
memory_audit_export
memory_audit_stats
memory_export
memory_import
memory_inject
```

`memory_save` supports the four scopes and six categories documented in the
[CLI reference](CLI.md), conflict strategies, semantic/LLM deduplication,
machine-local memories, activation guidance, and ordered sequence groups.
`memory_recall` supports `as_of` temporal recall; list also accepts `as_of`.

### Agents, projects, focus, and machines (16)

```text
register_agent
list_agents
get_agent
update_agent
list_agents_by_project
register_project
list_projects
get_project
register_machine
list_machines
rename_machine
set_primary_machine
set_focus
heartbeat
get_focus
unfocus
```

Use stable agent and project IDs in memory calls after registration. Machine
registration uses the normalized hostname as an account-local idempotency key,
not as an authorization boundary; the returned machine `id` is the stable
identity required by rename and primary mutations. Re-registering the same
hostname refreshes its presence but never renames or takes over the existing
row. A primary machine controls fallback visibility/synchronization behavior;
startup warns when no primary machine is configured. Machine tools are exposed
only by the `admin` and `full` MCP profiles.

### Knowledge graph (19)

```text
entity_create
entity_get
entity_list
entity_delete
entity_merge
entity_link
entity_update
entity_unlink
entity_disambiguate
relation_get
relation_create
relation_list
relation_delete
graph_query
graph_path
graph_stats
graph_traverse
build_file_dep_graph
memory_tool_insights
```

### Locks and bulk operations (10)

```text
bulk_forget
bulk_update
memory_lock
memory_unlock
memory_check_lock
resource_lock
resource_unlock
resource_check_lock
list_agent_locks
clean_expired_locks
```

Memory write locks are short-lived coordination primitives. Resource locks
support advisory/exclusive ownership for projects, memories, entities, agents,
connectors, and files.

### Hooks, sessions, and synthesis (21)

```text
hook_list
hook_stats
webhook_create
webhook_list
webhook_delete
webhook_update
memory_synthesize
memory_synthesis_status
memory_synthesis_history
memory_synthesis_rollback
memory_auto_process
memory_auto_status
memory_auto_config
memory_auto_test
memory_autoinject_config
memory_autoinject_status
memory_autoinject_test
memory_ingest_session
memory_session_status
memory_session_list
session_extract
```

Auto-memory and synthesis require a configured provider. Supported provider
names are `anthropic`, `openai`, `cerebras`, and `grok`; the corresponding keys
are described in [Configuration and storage](CONFIGURATION.md).

### Context, discovery, and maintenance (7)

```text
clean_expired
memory_briefing
memory_context
memory_context_layered
memory_profile
search_tools
describe_tools
```

### Events and administration (13)

```text
memory_subscribe
memory_unsubscribe
memory_save_tool_event
send_feedback
migrate_pg
memory_audit
memory_rate
memory_gdpr_erase
memory_acl_set
memory_acl_list
memory_evict
memory_save_image
memory_compress
```

`migrate_pg` is a remote database mutation unless called with `dry_run: true`.
Image description can use `OPENAI_API_KEY` when an image URL is supplied without
a description.

### Storage, consolidation, and reflection (8)

```text
mementos_storage_status
mementos_storage_push
mementos_storage_pull
mementos_storage_sync
mementos_storage_migrate_dry_run
mementos_storage_feedback
memory_consolidate
memory_reflect
```

The push/pull/sync tools are retained compatibility paths, not the self-hosted
cloud cutover architecture. The migration MCP surface is deliberately dry-run
only; a live migration is an explicit administrative CLI/server operation.

## Resources

| URI | Contents |
| --- | --- |
| `mementos://memories` | Up to 1,000 active memories as JSON |
| `mementos://agents` | All registered agents as JSON |
| `mementos://projects` | All registered projects as JSON |

Resource reads use the selected store and therefore obey the same local/API
mode boundary as tools.
