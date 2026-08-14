# MCP Reference

## Transport

`prompts-mcp` defaults to stateless Streamable HTTP on `127.0.0.1:8872`.

```text
Usage: prompts-mcp [--stdio|--http] [--port <port>]

Options:
  --stdio       Run MCP over stdio
  --http        Run MCP over Streamable HTTP
  --port <port> HTTP port (default: 8872)
  -V, --version Print package version
  -h, --help    Show help
```

`MCP_STDIO=1`, `MCP_HTTP=1`, and `MCP_HTTP_PORT` provide environment-based
selection. Stdio wins when both modes are selected. HTTP exposes `GET /health`
and accepts MCP requests at `/mcp`.

The REST binary also mounts the same MCP server at `/mcp` on its own port.

## Prompt Tools

| Tool | Behavior |
| --- | --- |
| `prompts_save` | Create/update a prompt and return a compact save result. |
| `prompts_save_from_session` | Save a prompt with session metadata and optional agent/project context. |
| `prompts_get` | Get prompt metadata; body inclusion is explicit. |
| `prompts_body` | Return the full body without incrementing usage. |
| `prompts_use` | Return the full body and increment usage. |
| `prompts_update` | Patch prompt fields. |
| `prompts_delete` | Delete a prompt. |
| `prompts_list` | List slim prompt records with filters and pagination. |
| `prompts_search` | Search slim records with filters and pagination. |
| `prompts_similar` | Find prompts by tag overlap and collection. |
| `prompts_list_templates` | List template prompts. |
| `prompts_variables` | Return detected template variables. |
| `prompts_render` | Increment usage, render template variables, and record optional mementos. |
| `prompts_validate_vars` | Report missing, extra, and optional variables. |
| `prompts_duplicate` | Clone a prompt. |
| `prompts_pin` / `prompts_unpin` | Change pinned ordering. |
| `prompts_set_expiry` | Set or clear expiry. |
| `prompts_chain` | Read, set, or clear the next-prompt chain. |

## Organization and History Tools

| Tool | Behavior |
| --- | --- |
| `prompts_collections` | List collections with prompt counts. |
| `prompts_ensure_collection` | Create a collection if absent. |
| `prompts_move` | Move one prompt to a collection. |
| `prompts_bulk_move` | Move multiple prompts. |
| `prompts_bulk_tag` | Add/remove tags across multiple prompts. |
| `prompts_history` | List compact versions; body inclusion is explicit. |
| `prompts_restore` | Restore a stored body as a new version. |
| `prompts_diff` | Return a formatted or structured version diff. |

## Discovery and Quality Tools

| Tool | Behavior |
| --- | --- |
| `prompts_recent` | Return recently used prompts with pagination. |
| `prompts_unused` | Return never-used prompts with pagination. |
| `prompts_stale` | Return prompts unused during a lookback. |
| `prompts_trending` | Return most-used prompts in a lookback. |
| `prompts_stats` | Return usage statistics. |
| `prompts_lint` | Return prompt-quality findings. |
| `prompts_audit` | Return registry-integrity findings. |
| `prompts_storage_diagnostics` | Return redacted local/remote boundary diagnostics. |

## Import and Export Tools

| Tool | Behavior |
| --- | --- |
| `prompts_export` | Export full JSON prompt records. |
| `prompts_import` | Import prompt records. |
| `prompts_export_as_skills` | Write prompts as Markdown skill files. |
| `prompts_import_slash_commands` | Scan supported agent command directories. |

## Project, Schedule, and Agent Tools

| Tool | Behavior |
| --- | --- |
| `prompts_project_create` | Create a project. |
| `prompts_project_list` | List projects with pagination. |
| `prompts_project_get` | Get a project. |
| `prompts_project_delete` | Delete a project and globalize its prompts. |
| `prompts_schedule` | Create a five-field cron schedule. |
| `prompts_list_schedules` | List compact schedules. |
| `prompts_unschedule` | Delete a schedule. |
| `prompts_get_due` | Render and advance due schedules. |
| `prompts_next_run` | Preview cron run times. |
| `register_agent` | Register or refresh an agent identity. |
| `heartbeat` | Refresh an agent heartbeat. |
| `set_focus` | Set or clear an agent's active project. |
| `list_agents` | List registered agents. |

## Config and Feedback Tools

| Tool | Behavior |
| --- | --- |
| `prompts_config_list` | List known agent config paths. |
| `prompts_config_get` | Read a local/global agent config. |
| `prompts_config_set` | Write a local/global agent config. |
| `prompts_config_inject` | Inject a prompt into an agent config. |
| `prompts_config_scan` | Scan workspace repositories for configs. |
| `send_feedback` | Store product feedback in the local prompts database. |

List/search/status tools use capped pages and compact records. Read each tool's
published input schema in the MCP client for exact optional fields, defaults,
and `include_body` controls.
