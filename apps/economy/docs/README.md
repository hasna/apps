# Economy documentation

Economy can run as an on-machine SQLite application or as a client of a shared self-hosted HTTP service. These guides describe the current command and network surfaces:

- [CLI reference](cli.md) — the `economy` command and the four installed binaries.
- [Ingestion](ingestion.md) — supported sources, default paths, sync behavior, billing, and account attribution.
- [Configuration and deployment](configuration.md) — data paths, environment variables, local/server modes, and authentication.
- [REST API](rest-api.md) — canonical `/v1` routes, request conventions, probes, and legacy aliases.
- [MCP server](mcp.md) — stdio/HTTP setup and the available tools.
- [OTLP sidecar](otel.md) — OTLP metrics and the simplified `/ingest` payload.

For generated API details, start `economy-serve` and open [`/openapi.json`](http://127.0.0.1:3456/openapi.json). The checked-in source is [`openapi/economy.json`](../openapi/economy.json).
