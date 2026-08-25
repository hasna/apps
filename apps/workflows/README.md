# @hasna/workflows

Universal graph workflow app: a graph language (with `while` nodes), a
three-table store, session WAL with torn-run repair, memoization, a secrets
write-gate, a claims/leases daemon, and four lane adapters (claude, codex,
cursor, grok) — one domain implementation, four interface surfaces.

## Surfaces

| surface | bin / export | what it is |
|---|---|---|
| CLI | `workflows` | 14 commands: init, validate, run, runs list/show/cancel/resume, nodes, daemon start/status/stop, memos list/clear, lanes list (+ repair, version, health, info) |
| MCP | `workflows-mcp` | stdio MCP server for coding agents (7 tools incl. workflows_validate, workflows_run, workflows_runs_list, workflows_lanes_list) |
| Serve | `workflows-serve` | HTTP server (`/health`, `/ready`, `/version`, `/openapi.json`); binds `127.0.0.1` by default |
| SDK | `./sdk` (`@hasna/workflows/sdk`) | importable module surface (exports `WorkflowsService`, `createWorkflowsService`, `createRequestHandler`, `workflowsTools`, `callWorkflowTool`); hand-authored to `/openapi.json` — no code-generated client, no API-key auth in 0.1.0 |

All three bins answer `--version` / `--help` before binding or serving.

## The graph language (v1)

A workflow is a JSON graph with five node types — `start`, `step`, `decision`,
`while`, `end` — one `start`, at least one `end`, explicit edges only
(`next`/`then`/`else`), and no explicit cycles: repetition lives in the `while`
node's condition, which is REQUIRED to carry a finite `maxIterations` bound.
`validate` reports every rule violation with a dotted path. Conditions are a
bounded expression language (comparisons, `and`/`or`/`not`, parens, dotted
paths like `steps.build.exitCode`, and the loop counter `i`).

```json
{
  "name": "retry-until-green",
  "version": "1.0.0",
  "nodes": [
    { "id": "start", "type": "start", "next": "w" },
    { "id": "w", "type": "while", "condition": "steps.check.ok != true",
      "body": ["work", "check"], "maxIterations": 5, "next": "done" },
    { "id": "work", "type": "step", "lane": "claude", "prompt": "fix it" },
    { "id": "check", "type": "step", "command": "bun test" },
    { "id": "done", "type": "end" }
  ]
}
```

## Execution model

- **Store**: exactly three SQLite tables — `runs`, `run_nodes`, `memos`
  (input-hash memoization across runs).
- **Session WAL**: append-only JSONL journal with per-entry sha256 checksums;
  torn tails are truncated and reported on replay.
- **Torn-run repair**: a run left `running` with no live claim is requeued
  (attempts + 1, up to a bound) or failed; `repair` exposes it.
- **Daemon**: fencing-tokened, expiring, WAL-recorded claims; heartbeat and
  release are fencing-checked; the reaper expires stale leases, repairs torn
  runs, dispatches pending runs, and advances each run ONE step per bounded
  cycle (maxDispatchPerCycle / maxStepsPerCycle / maxCycles / maxIterations
  — every invocation carries a finite budget).
- **Secrets write-gate**: no node output, run result, or context containing a
  credential-shaped value is ever persisted; the write is refused with the
  path and detector named.
- **Lanes**: exactly four adapters — claude (@anthropic-ai/claude-agent-sdk),
  codex (@openai/codex-sdk), cursor (@cursor/sdk, local mode), grok (no xAI
  Grok SDK exists on npm — measured; local grok CLI). Each falls back to its
  local CLI and reports LANE_DEPENDENCY_MISSING (exit 127) when neither
  substrate exists.

## Usage

```bash
workflows --version
workflows init                 # scaffold a sample graph
workflows validate graph.json
workflows run graph.json --context '{"repo":"x"}'
workflows runs list
workflows runs show <run-id>
workflows daemon start --once  # or a continuous reap loop
workflows memos clear --yes
workflows lanes list
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
