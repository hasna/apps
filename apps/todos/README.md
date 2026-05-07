# @hasna/todos

Universal task management for AI coding agents - CLI + MCP server + interactive TUI

[![npm](https://img.shields.io/npm/v/@hasna/todos)](https://www.npmjs.com/package/@hasna/todos)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/todos
```

## CLI Usage

```bash
todos --help
```

## MCP Server

```bash
todos-mcp
```

The MCP server defaults to the token-saving `TODOS_PROFILE=minimal` profile.
Use `TODOS_PROFILE=standard` for broader task/project/resource tools, or
`TODOS_PROFILE=full` when you explicitly need every tool. You can add groups
with `TODOS_TOOL_GROUPS=cloud,templates`.

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

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service todos
cloud sync pull --service todos
```

## Data Directory

Data is stored in `~/.hasna/todos/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
