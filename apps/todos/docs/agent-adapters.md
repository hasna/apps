# Local Agent Adapter Recipes

`@hasna/todos` is a local-first task system for coding agents. These recipes
keep Codex, Claude Code, Takumi, and plain terminal agents on the same local
project state without a hosted service.

## Install And Bootstrap

```bash
bun install -g @hasna/todos
todos project-bootstrap "$PWD" --json
todos status --json
```

The bootstrap command discovers the current workspace, creates local project
state, and keeps task data in the local SQLite store.

## MCP Registration

Register the local MCP server with supported agent clients:

```bash
todos mcp --register codex --global
todos mcp --register claude --global
todos mcp --register gemini --global
```

For clients that accept an explicit stdio server command, configure:

```bash
todos mcp
```

Takumi-style adapters can use the same stdio command and the CLI recipes below
when direct MCP registration is managed outside this package.

## `/goal` Planning Flow

Use the bundled local workflow prompt as the agent-facing planning brief:

```bash
todos workflows show goal-planning \
  --objective "Ship the parser without breaking existing imports" \
  --agent codex
```

Turn the resulting plan notes into a dry-run task preview before creating
records:

```bash
todos inbox parse --file goal-plan.md --json
todos inbox parse --file goal-plan.md --apply --json
```

The parser previews and applies local projects, plans, tasks, dependencies, and
acceptance criteria only when `--apply` is present.

## Claim, Execute, And Complete

Agents should claim work atomically, inspect the task, record progress, record
verification, and complete only after evidence exists:

```bash
todos claim codex --project "$PROJECT_ID" --json
todos inspect "$TASK_ID"
todos comment "$TASK_ID" "Starting local implementation."
todos update "$TASK_ID" --status in_progress --assign codex
todos context-pack "$TASK_ID" --profile codex --format markdown
todos record-verification "$TASK_ID" "bun test" --status passed --summary "All local tests passed." --agent codex
todos comment "$TASK_ID" "Implemented locally; verification recorded."
todos done "$TASK_ID" \
  --commit-hash "$GIT_COMMIT" \
  --files-changed "src/parser.ts,src/parser.test.ts" \
  --test-results "bun test passed" \
  --notes "Local task complete." \
  --confidence 1
```

Claude Code can use `--profile claude`; Takumi can use `--profile takumi`.
All profiles render deterministic local context packs.

## No-Cloud Expectations

These recipes do not require remote task APIs, telemetry, object storage, or
provider tokens. Agents should keep credentials out of task text, prefer
`todos redaction scan` before exports, and run the no-cloud gate before release:

```bash
todos --json redaction scan --file docs/agent-adapters.md
bun run test:no-cloud
```
