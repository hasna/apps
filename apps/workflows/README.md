# @hasna/workflows

Universal graph workflow app: a graph language (with `while` nodes), a
three-table store, session WAL with torn-run repair, memoization, a secrets
write-gate, a claims/leases daemon, and four lane adapters (claude, codex,
cursor, grok) — one domain implementation, four interface surfaces.

## Surfaces

| surface | bin / export | what it is |
|---|---|---|
| CLI | `workflows` | command-line surface (version, health, info today; the full command set lands with the CLI slice) |
| MCP | `workflows-mcp` | stdio MCP server for coding agents (`workflows_version`, `workflows_health`, `workflows_ready`) |
| Serve | `workflows-serve` | HTTP server (`/health`, `/ready`, `/version`, `/openapi.json`); binds `127.0.0.1` by default |
| SDK | `./sdk` (`@hasna/workflows/sdk`) | importable module surface |

All three bins answer `--version` / `--help` before binding or serving.

## Usage

```bash
workflows --version
workflows health --json
workflows-mcp                  # stdio MCP server
workflows-serve                # HTTP server, port from HASNA_WORKFLOWS_PORT (default 8790)
```

```ts
import { createWorkflowsService } from "@hasna/workflows/sdk";

const svc = createWorkflowsService();
console.log(svc.health());
```

## Configuration

| variable | meaning | default |
|---|---|---|
| `HASNA_WORKFLOWS_PORT` / `WORKFLOWS_PORT` | serve port | 8790 |
| `HASNA_WORKFLOWS_HOST` / `WORKFLOWS_HOST` | serve bind host | 127.0.0.1 |
| `HASNA_WORKFLOWS_DATA_DIR` / `WORKFLOWS_DATA_DIR` | data directory | `~/.hasna/workflows` |

The server data backend is sqlite (default) or postgresql when
`HASNA_WORKFLOWS_DATABASE_URL` is set.

## License

Apache-2.0
