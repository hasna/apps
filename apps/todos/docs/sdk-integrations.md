# Local SDK Integration Fixtures

`@hasna/todos` ships copy-pasteable examples and deterministic local fixtures
for downstream tools that need to consume tasks, projects, plans, runs, context
packs, and evidence without importing private modules or relying on hosted
services.

## Fixture Pack

Create a repeatable local fixture database and write all integration snapshots:

```bash
todos sdk-fixtures --json
todos sdk-fixtures --show > sdk-fixture-pack.json
todos sdk-fixtures --write .todos/sdk-integrations --json
```

The write command produces:

- `fixture-pack.json` with package metadata, example inventory, snapshot
  resources, contract snapshots, and one agent context pack.
- `agent-project-demo.bridge.json` with the seeded project, task list, plan,
  tasks, dependencies, run ledger, evidence, saved view, board, and calendar
  item.
- `contract-snapshots.json` with the stable JSON contract manifest, CLI/MCP
  parity manifest, local snapshot catalog, project/task/plan/run/evidence
  snapshots, and context pack.
- `examples.json` with the example index.

The fixture command imports the bundled `agent-project-demo` data into the
current local SQLite store. Reset that store with the `reset_command` field in
the fixture pack when you want a clean run.

## Examples

The examples live under `examples/sdk-integrations/`:

- `bun-sdk.ts` uses `@hasna/todos/sdk` against a local `todos serve` process.
- `cli-json-consumer.ts` reads public CLI JSON for projects, ready tasks,
  context packs, and task snapshots.
- `mcp-client.ts` connects to `todos-mcp` over stdio and calls local MCP tools.
- `agent-adapter.ts` shows the minimal loop for claiming a ready task, building
  context, recording verification, and finishing the task.

Each example targets a public package surface: `@hasna/todos`, `todos`,
`todos-mcp`, or `@modelcontextprotocol/sdk`.

## Agent Adapters

Adapters should treat the local SQLite store as the source of truth:

```bash
todos onboarding --import agent-project-demo --apply --json
todos ready --json
todos context-pack <task-id> --json
todos snapshots --show evidence --json
todos record-verification <task-id> "bun test" --status passed --json
todos done <task-id> --json
```

For `/goal` style agents, create a project, parse or add the goal tasks, ask the
agent to execute the plan one task at a time, and record command or file
evidence after each verification step. The stable contracts in
`docs/json-contracts.md` let Codex, Claude Code, Takumi, editor plugins, and
custom agents consume the same local queue without package internals.
