# Attachments Documentation

The root [README](../README.md) is the quick start. These pages document the
current executable surfaces in more detail.

- [CLI reference](cli.md) — commands, arguments, options, and integrations
- [MCP reference](mcp.md) — transports, profiles, and all 22 tools
- [HTTP API reference](api.md) — local and hosted APIs
- [Configuration and deployment](configuration.md) — storage, links,
  environment variables, domains, and hosted operation

The package has two HTTP applications with intentionally different contracts:

- `attachments serve` is the local-first SQLite API under `/api`.
- `attachments-serve` is the hosted Postgres API under `/v1` and publishes
  its OpenAPI document at `/openapi.json`.

There is no synchronization workflow. The client selects its backend from the
environment (a configured API URL + key pair selects the hosted API, otherwise
local SQLite); the server selects its data backend from a configured
`HASNA_ATTACHMENTS_DATABASE_URL` (PostgreSQL) or SQLite.
