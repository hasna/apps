# @hasna/tickets

Open-source MCP-native ticketing system — bugs, features, incidents for any product, service, or app. CLI + MCP server + REST API + Web Dashboard + SDK.

[![npm](https://img.shields.io/npm/v/@hasna/tickets)](https://www.npmjs.com/package/@hasna/tickets)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/tickets
```

## CLI Usage

```bash
tickets --help
```

## MCP Server

```bash
tickets-mcp
```

## HTTP mode

Shared Streamable HTTP transport for long-lived local MCP (stdio remains the default):

```bash
tickets-mcp --http              # or MCP_HTTP=1
tickets-mcp --http --port 8841  # default port 8841
```

- Bind: `127.0.0.1` only
- Health: `GET /health` → `{"status":"ok","name":"tickets"}`
- MCP: `POST /mcp` (Streamable HTTP, stateless)

## REST API

```bash
tickets-serve
```

## Data Directory

Tickets owns its local SQLite store directly. By default data is stored in
`~/.hasna/tickets/`; set `HASNA_TICKETS_DB_PATH` or `TICKETS_DB_PATH` to use a
specific database file. When no explicit path is set, the CLI also discovers
`.tickets/tickets.db` in the current directory or an ancestor.

External PostgreSQL deployments may reuse the exported `PG_MIGRATIONS` schema
with their own database adapter.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
