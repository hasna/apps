# @hasna/todos

Universal task management for AI coding agents - CLI + MCP server + interactive TUI

[![npm](https://img.shields.io/npm/v/@hasna/todos)](https://www.npmjs.com/package/@hasna/todos)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/todos
```

## CLI Usage

```bash
todos --help
```

## Local Dependency Workflows

Dependencies are stored in the local SQLite database and never require hosted
services. Use them to keep agents from starting blocked work:

```bash
todos deps <task-id> --needs <blocking-task-id>
todos deps <task-id> --graph
todos blocked
todos ready
```

The same workflow is available to MCP clients through
`add_task_dependency`, `remove_task_dependency`, `get_task_dependencies`, and
`get_blocked_tasks`. Dependency writes reject cycles, `ready` omits locked or
blocked pending tasks, and startup schema repair recreates the local dependency
table for older databases.

## Local Plan Templates

Reusable plan templates also live in the local SQLite database. They can create
one task or a full ordered plan with dependencies, variables, priorities, tags,
and descriptions:

```bash
todos template-init
todos template-preview <template-id> --var name=api
todos templates --use <template-id> --var name=api
todos template-export <template-id> > plan-template.json
todos template-import plan-template.json
```

`todos templates --use` creates every task in a multi-task template and wires
its local dependency graph, so agents can immediately run `todos ready`,
`todos blocked`, or `todos deps <task-id> --graph` against the generated plan.
The same local-only workflow is available to MCP clients through
`create_template`, `list_templates`, `create_task_from_template`,
`preview_template`, `export_template`, and `import_template`.

## MCP Server

```bash
todos-mcp
```

The MCP server defaults to the token-saving `TODOS_PROFILE=minimal` profile.
Use `TODOS_PROFILE=standard` for broader task/project/resource tools, or
`TODOS_PROFILE=full` when you explicitly need every tool. You can add groups
with `TODOS_TOOL_GROUPS=templates`.

High-volume tools return compact payloads by default. Pass `detail: "full"` to
MCP calls such as `get_task`, `get_status`, `get_context`, `bootstrap`, and
`task_context` when you need full data.

## REST API

```bash
todos-serve
```

Generate an API key before exposing the REST API to another app. Once at least one
generated key exists, all `/api/*` requests require `x-api-key` or
`Authorization: Bearer`.

```bash
todos api-keys create "My app"
todos-serve --host 0.0.0.0
```

Pass the generated key from your app as `x-api-key` or set `TODOS_API_KEY` for
the SDK client.

Agent callers can trim REST responses with field selectors:

```bash
curl "http://localhost:19427/api/tasks?fields=id,title,status,priority"
curl "http://localhost:19427/api/tasks/<id>?fields=id,title,status"
curl "http://localhost:19427/api/tasks/<id>/history?limit=20"
```

## Data Directory

Data is stored in `~/.hasna/todos/`.

## Local-Only Security Boundary

`@hasna/todos` is an open source, local-first package. The CLI, MCP server, SDK,
and local dashboard read and write local state by default and do not require a
hosted API, cloud account, billing provider, or remote model provider.

Release checks enforce that boundary before publishing:

- package metadata must stay public and point at `hasna/todos`
- install snippets must use `bun install -g @hasna/todos`
- package dependencies and generated tarballs are scanned for private or hosted
  service coupling
- public text surfaces and packed files are scanned for secret-like values
- local runtime tests use a no-network fixture for local-only workflows
- `bun run verify:release` builds, packs, validates provenance, and runs a clean
  Bun global install smoke test from the candidate tarball

## License

Apache-2.0 -- see [LICENSE](LICENSE)
