# open-actions

Typed, auditable action contracts for agentic software.

`open-actions` is an OSS primitive for making multi-step operator work safer.
An action manifest can describe typed inputs and outputs, dry-run behavior,
approval requirements, guardrails, idempotency, execution bindings, audit
events, evidence, and rollback metadata.

It is not a wrapper around a shell command or SDK call. A wrapper says "run this."
An open action says what will run, who is allowed to run it, what it touches, how
to preview it, how to approve it, how to dedupe retries, where audit events go,
and what rollback or compensating action is available.

## Install

```bash
bun add @hasna/actions
```

## Documentation

- [Manifest contract](docs/manifests.md)
- [SDK lifecycle and API](docs/sdk.md)
- [CLI command reference](docs/cli.md)
- [MCP server and tools](docs/mcp.md)
- [Storage and security](docs/storage.md)
- [Project dashboard integrations](docs/project-dashboards.md)
- [Runtime and queue contracts](docs/contracts.md)

## Manifest Shape

```ts
import { createTypeScriptAction } from "@hasna/actions";

const action = createTypeScriptAction({
  manifest: {
    id: "projects.metadata.update",
    name: "Update project metadata",
    version: "1.0.0",
    description: "Patch project metadata after preview and approval.",
    inputSchema: {
      type: "object",
      required: ["project", "metadata"],
      properties: {
        project: { type: "string" },
        metadata: { type: "object" }
      }
    },
    outputSchema: {
      type: "object",
      required: ["updated"],
      properties: { updated: { type: "boolean" } }
    },
    actor: { types: ["human", "agent"], required: true },
    resource: { type: "project", identifiers: ["project"] },
    scope: { level: "workspace", permissions: ["project:metadata:update"] },
    riskLevel: "medium",
    requiredApprovals: [{ kind: "manual", count: 1, reason: "metadata mutation" }],
    idempotency: { supported: true, required: true, keyHint: "project + patch hash" },
    dryRun: { supported: true, default: true },
    confirmation: {
      title: "Update project metadata",
      summaryTemplate: "Update metadata for {{project}}",
      fields: ["project", "metadata"]
    },
    guardrail: { hook: "project-metadata-policy", failClosed: true },
    audit: { eventTypes: ["action.planned", "action.executed"], includeInput: true },
    evidence: { required: false, fields: ["diff", "command"] },
    rollback: { strategy: "compensating-action", actionId: "projects.metadata.restore" },
    executorBindings: [{ kind: "typescript", ref: "examples/project-workflow.ts#updateMetadata" }]
  },
  preview: async ({ input }) => ({
    summary: `Would update ${input.project}`,
    changes: [{ kind: "metadata", target: input.project, after: input.metadata }]
  }),
  execute: async ({ input }) => ({ updated: true, project: input.project })
});
```

## SDK

```ts
import { ActionsClient, JsonActionsStore } from "@hasna/actions";

const client = new ActionsClient({
  store: new JsonActionsStore(),
  guardrailHooks: [
    async ({ manifest }) => (
      manifest.riskLevel === "critical"
        ? { decision: "deny", reason: "critical actions require an external policy" }
        : { decision: "allow" }
    )
  ],
  auditSinks: [
    async (event) => {
      // Bridge to @hasna/events, a webhook, or a local ledger.
      console.log(event.type, event.runId);
    }
  ]
});

await client.register(action);

const preview = await client.run({
  actionId: "projects.metadata.update",
  input: { project: "open-actions", metadata: { stage: "active" } },
  actor: { id: "hasna", type: "human" },
  idempotencyKey: "open-actions-stage-active",
  dryRun: true
});

const run = await client.run({
  actionId: "projects.metadata.update",
  input: { project: "open-actions", metadata: { stage: "active" } },
  actor: { id: "hasna", type: "human" },
  idempotencyKey: "open-actions-stage-active-v2",
  dryRun: false
});

await client.approve(run.id, {
  actor: { id: "hasna", type: "human" },
  decision: "approved",
  reason: "Preview matches request"
});

await client.execute(run.id);
```

## Local Shell Executor

Shell actions are still typed contracts. The command is an executor binding,
not the whole action. See the complete executable manifest at
[`examples/local-shell.manifest.json`](examples/local-shell.manifest.json) and
the [local-shell SDK reference](docs/sdk.md#local-shell-actions).

Run a local shell action manifest:

```bash
actions run examples/local-shell.manifest.json \
  --input '{"name":"open-actions"}' \
  --idempotency-key demo-1 \
  --dry-run \
  --json
```

The CLI passes `dryRun: false` unless `--dry-run` is present, so omitting the
flag requests execution after preview and any required approvals. SDK and MCP
requests that omit `dryRun` use the manifest's `dryRun.default` value.

## CLI

CLI output is compact by default for humans and agents. List commands cap human
rows, truncate long summaries, include totals, and print the next command to run
when more rows are available. Use `show`/`inspect` or `--verbose` for bounded
detail. Use `--json` only when a full machine-readable record is needed; JSON
output preserves the stored manifest/run shape.

```text
actions [--dir <path>] status [--verbose] [--json]
actions [--dir <path>] project-panel --project <slug> [--limit <n>] [--contract] [--json]
actions [--dir <path>] manifests validate <file> [--verbose] [--json]
actions [--dir <path>] manifests list [--limit <n>] [--cursor <offset>] [--verbose] [--json]
actions [--dir <path>] manifests show <id> [--verbose] [--json]
actions [--dir <path>] manifests inspect <id> [--json]
actions [--dir <path>] run <manifest> [--input <json> | --input-file <path>] [--idempotency-key <key>] [--actor <id>] [--dry-run] [--approve] [--verbose] [--json]
actions [--dir <path>] runs list [--action <id>] [--status <status>] [--limit <n>] [--cursor <offset>] [--verbose] [--json]
actions [--dir <path>] runs show <id> [--verbose] [--json]
actions [--dir <path>] runs inspect <id> [--json]
actions [--dir <path>] approve <run-id> [--actor <id>] [--reason <text>] [--verbose] [--json]
actions [--dir <path>] deny <run-id> [--actor <id>] [--reason <text>] [--verbose] [--json]
actions [--dir <path>] execute <run-id> <manifest> [--verbose] [--json]
```

`<id>` and `<run-id>` accept an exact id or an unambiguous prefix. See the
[CLI reference](docs/cli.md) for flag behavior, JSON pagination, and the project
panel's matching rules.

## MCP

`actions-mcp` exposes the same local-first action store to agents:

- `actions_register_manifest`
- `actions_list_manifests`
- `actions_show_manifest`
- `actions_run`
- `actions_approve`
- `actions_deny`
- `actions_execute`
- `actions_show_run`
- `actions_list_runs`

MCP tools also use compact output by default. `actions_list_manifests` and
`actions_list_runs` return paginated summary envelopes with `page.nextCursor`.
Pass `limit` and `cursor` to page through records. Pass `detail: "verbose"` for
bounded previews or `detail: "full"` for paginated full records. Prefer
`actions_show_manifest` and `actions_show_run` when an agent needs one complete
record.

The first version executes stored local-shell manifests over MCP. TypeScript SDK
actions are registered in-process by the host application.

See the [MCP reference](docs/mcp.md) for every tool input and detail level.

## Integration Model

- `open-guardrails`: provide guardrail hooks that inspect manifest, actor,
  input, scope, and preview before execution.
- `open-orgs`: resolve actor roles and approval authority before calling
  `approve`.
- `open-dispatch`: expose dispatch operations as medium/high-risk actions with
  dry-run, target policy, and capture evidence.
- `open-projects`: represent create/publish/update workflows as composable
  action plans with rollback or compensating-action metadata.
- `open-events`: receive audit events emitted by `ActionsClient` audit sinks.

## Project Dashboard Boundary

Project dashboards should render actions as server-issued capabilities, not as
shell commands or direct SDK calls. Use `projectActionCapability(manifest)` to
derive a view-safe object for the dashboard. The projection includes labels,
risk, scope, dry-run support, approval requirements, audit/evidence fields, and
blockers. It intentionally omits executor bindings, commands, environment, and
raw implementation details.

V1 dashboards are read-only by default. A mutation-capable action is available
only when the manifest supports dry-run preview, defaults to dry-run, includes a
preview audit event, has a confirmation title, and defines an approval policy
for medium/high/critical risk. Critical actions also require a fail-closed
guardrail. The dashboard should request a server-side dry-run first, then use
the returned run id for explicit confirmation and approval. It should never
execute arbitrary commands from rendered JSON.

The separate `actions project-panel` command emits a bounded
`hasna.project_panel.v1` summary of project-scoped manifests and recent runs.
See [Project dashboard integrations](docs/project-dashboards.md) for both
contracts.

## Storage

Default local data directory:

```text
~/.hasna/actions
```

Override with `HASNA_ACTIONS_DIR` or `HASNA_ACTIONS_HOME`.

The storage interface is intentionally small so the same contract can later be
backed by SQLite, Postgres, a gateway service, or a signed audit ledger.

Local shell executors pass `PATH`, `HOME`, and temp directory variables by
default, plus explicit manifest `env` values. They do not inherit the whole
process environment unless `inheritEnv` is set, so unrelated local secrets are
not casually forwarded to action commands.

The JSON store does not coordinate concurrent writers. See
[Storage and security](docs/storage.md) for file layout, permissions, and the
current security boundaries.
