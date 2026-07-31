# REST API Reference

## Run the Server

```text
Usage: prompts-serve [--port <port>]

Options:
  --port <port> Set HTTP port with PROMPTS_PORT or PORT
  -V, --version Print package version
  -h, --help    Show help
```

The default port is `19430`. Port precedence is `--port`, `PORT`,
`PROMPTS_PORT`, then the default. The API sends JSON and
`Access-Control-Allow-Origin: *`; `OPTIONS` supports GET, POST, PUT, and DELETE.

## Prompt Routes

| Method and path | Request/query | Response |
| --- | --- | --- |
| `GET /api/prompts` | `collection`, comma-separated `tags`, presence-only `templates`, `source`, `limit` (20), `offset` (0), `project`, presence-only `full` | Slim prompt array, or full records with `full`. Project scope includes global prompts. |
| `POST /api/prompts` | Create-prompt JSON (`title` and `body` required) | Compact save result; `201` when created, `200` when updated. |
| `GET /api/prompts/:id` | — | Full prompt record. |
| `PUT /api/prompts/:id` | Update-prompt JSON | Compact save result. |
| `DELETE /api/prompts/:id` | — | `{ deleted, id }`. |
| `POST /api/prompts/:id/use` | — | Full body and prompt; increments usage. |
| `POST /api/prompts/:id/render` | `{ "vars": { "name": "value" } }` | Rendered text, missing variables, and used defaults. |
| `POST /api/prompts/:id/move` | `{ "collection": "name" }` | Move confirmation. |
| `GET /api/prompts/:id/history` | — | Full version records. |
| `POST /api/prompts/:id/restore` | `{ "version": 2, "changed_by": "agent" }` | Restore confirmation. |
| `GET /api/prompts/:id/similar` | `limit` (5) | Ranked search-result records. |
| `GET /api/prompts/:id/variables` | — | Detected template variable metadata. |

## Search and Registry Routes

| Method and path | Request/query | Response |
| --- | --- | --- |
| `GET /api/search` | `q`, `collection`, comma-separated `tags`, presence-only `templates`, `limit` (20), presence-only `full` | Slim search results, or full search records with `full`. |
| `GET /api/templates` | — | Full template prompt records, up to 1000. |
| `GET /api/collections` | — | Collections with prompt counts. |
| `POST /api/collections` | `{ "name": "...", "description": "..." }` | Ensured collection with `201`. |
| `GET /api/stats` | — | Prompt usage statistics. |
| `POST /api/import` | `{ "prompts": [...], "changed_by": "agent" }` | Created/updated/error counts. |
| `GET /api/export` | optional `collection` | Full prompt export and timestamp. |

## Project Routes

| Method and path | Request/query | Response |
| --- | --- | --- |
| `GET /api/projects` | — | Project array. |
| `POST /api/projects` | `{ "name": "...", "description": "...", "path": "..." }` | Created project with `201`. |
| `GET /api/projects/:id` | — | Project details. |
| `DELETE /api/projects/:id` | — | Delete confirmation; project prompts become global. |
| `GET /api/projects/:id/prompts` | `limit` (100), `offset` (0), presence-only `full` | Project and global prompts, slim by default. |

## Service Routes

| Method and path | Response |
| --- | --- |
| `GET /health` | `{ "status": "ok", "name": "prompts", "port": 19430 }` using the active port. |
| Any MCP method at `/mcp` | Stateless Streamable HTTP MCP response. |

Errors are JSON objects with an `error` string. Missing resources generally
return `404`, invalid required fields return `400`, and uncaught failures return
`500`. The server does not implement authentication; it is intended for a
trusted local or separately protected environment.
