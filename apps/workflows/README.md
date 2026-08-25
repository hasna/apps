# @hasna/workflows

Universal graph workflow app — 0.1.0 scaffold. This release ships the app
shell: identity, configuration resolution, health and readiness on all four
surfaces (CLI, MCP, serve, SDK).

The graph language (with `while` nodes), three-table store, session WAL with
torn-run repair, memoization, secrets write-gate, claims/leases daemon, and
four lane adapters (claude, codex, cursor, grok) are **roadmap slices — not
shipped in 0.1.0**. Nothing in this package reads or writes a workflow
database yet.

## Surfaces

| surface | bin / export | what it is |
|---|---|---|
| CLI | `workflows` | command-line surface (`version`, `health`, `info` today; the full command set lands with the CLI slice) |
| MCP | `workflows-mcp` | stdio MCP server for coding agents (`workflows_version`, `workflows_health`, `workflows_ready`) |
| Serve | `workflows-serve` | HTTP server (`/health`, `/ready`, `/version`, `/openapi.json`); binds `127.0.0.1` by default, no auth |
| SDK | `./sdk` (`@hasna/workflows/sdk`) | importable module surface (exports `WorkflowsService`, `createWorkflowsService`, `createRequestHandler`, `workflowsTools`, `callWorkflowTool`) |

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
| `HASNA_WORKFLOWS_DATA_DIR` / `WORKFLOWS_DATA_DIR` | data directory (reserved; no store in 0.1.0) | `~/.hasna/workflows` |

## License

Apache-2.0
