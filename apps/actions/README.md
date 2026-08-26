# @hasna/actions

Typed, auditable action contracts for agentic software.

`actions` is an OSS primitive for making multi-step operator work safer:
every action has a portable manifest, typed inputs and outputs, dry-run preview,
approval policy, guardrail hooks, idempotency, execution bindings, and audit
evidence.

It is not a wrapper around a shell command or SDK call. A wrapper says "run this."
An open action says what will run, who is allowed to run it, what it touches, how
to preview it, how to approve it, how to dedupe retries, where audit events go,
and what rollback or compensating action is available.

See the [documentation index](docs/README.md) for focused CLI, manifest, SDK,
MCP, storage/executor, and project dashboard references.

## Install

```bash
bun add @hasna/actions
```

The CLI, the MCP server, and the default SQLite store require Bun (`engines.bun
>= 1.0.0`). The library entry points also load under Node; see
[Storage](#storage) for the store you need there.

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

`ActionsClient` defaults to the SQLite store at the effective actions data home —
the legacy `~/.hasna/actions/actions.db` default, resolved through `@hasna/paths`,
until the XDG data home is adopted (the store is migrated there or `HASNA_DATA_HOME`
is set) — which is backed by `bun:sqlite` and therefore requires the Bun runtime.
See [Storage](#storage) for the Node fallback.

```ts
import { ActionsClient } from "@hasna/actions";

const client = new ActionsClient({
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
  input: { project: "actions", metadata: { stage: "active" } },
  actor: { id: "hasna", type: "human" },
  idempotencyKey: "actions-stage-active",
  dryRun: true
});

const run = await client.run({
  actionId: "projects.metadata.update",
  input: { project: "actions", metadata: { stage: "active" } },
  actor: { id: "hasna", type: "human" },
  idempotencyKey: "actions-stage-active-v2",
  dryRun: false
});

await client.approve(run.id, {
  actor: { id: "hasna", type: "human" },
  decision: "approved",
  reason: "Preview matches request"
});

await client.execute(run.id);
```

Outside Bun the default store throws, so select the JSON store explicitly:

```ts
import { ActionsClient, JsonActionsStore } from "@hasna/actions";

// Node: bun:sqlite is unavailable, so pass the JSON store.
const client = new ActionsClient({ store: new JsonActionsStore() });
```

## Local Shell Executor

Shell actions are still typed contracts. The command is an executor binding, not
the whole action.

```json
{
  "id": "dispatch.agent.followup",
  "name": "Dispatch follow-up to idle agents",
  "version": "1.0.0",
  "description": "Preview and dispatch a bounded prompt to agent sessions.",
  "inputSchema": { "type": "object" },
  "outputSchema": { "type": "object" },
  "actor": { "types": ["human", "agent"], "required": true },
  "resource": { "type": "agent-session" },
  "scope": { "level": "machine", "permissions": ["dispatch:send"] },
  "riskLevel": "medium",
  "requiredApprovals": [{ "kind": "manual", "count": 1 }],
  "idempotency": { "supported": true, "required": true },
  "dryRun": { "supported": true, "default": true },
  "confirmation": { "title": "Dispatch follow-up", "fields": ["target", "prompt"] },
  "guardrail": { "hook": "dispatch-target-policy", "failClosed": true },
  "audit": { "eventTypes": ["action.planned", "action.previewed", "action.executed"] },
  "evidence": { "required": false, "fields": ["dispatchId", "captureBefore"] },
  "rollback": { "strategy": "none", "notes": "Dispatch cannot be undone; use a compensating follow-up prompt." },
  "executorBindings": [
    {
      "kind": "local-shell",
      "command": "dispatch",
      "args": ["send", "--json", "--dry-run"],
      "inputMode": "env-json",
      "outputMode": "json"
    }
  ]
}
```

Run a local shell action manifest:

```bash
actions run examples/local-shell.manifest.json \
  --input '{"name":"actions"}' \
  --idempotency-key demo-1 \
  --dry-run \
  --json
```

## CLI

CLI output is compact by default for humans and agents. List commands cap human
rows, truncate long summaries, include totals, and print the next command to run
when more rows are available. Use `show`/`inspect` or `--verbose` for bounded
detail. Use `--json` only when a full machine-readable record is needed; JSON
output preserves the stored manifest/run shape.

See [the CLI reference](docs/cli.md) for every command, option, default, output
mode, and failure behavior.

```text
actions status
actions status --verbose
actions --dir /path/to/data status
actions project-panel --project <slug> --limit 20 --contract
actions manifests validate <file>
actions manifests list --limit 20
actions manifests show <id> --verbose
actions manifests inspect <id>
actions run <manifest-file> --input <json> --dry-run
actions run <manifest-file> --input-file input.json --approve --actor-role maintainer --verbose
actions runs list --status previewed --limit 20 --cursor 20
actions runs show <run-id>
actions runs inspect <run-id>
actions approve <run-id> --actor-role maintainer --reason "reviewed"
actions deny <run-id> --reason "rejected"
actions execute <run-id> <manifest-file> --verbose
actions runs list --json
actions runs show <run-id> --json
```

`run` always plans and previews first. A dry-run remains `previewed`; a non-dry
run executes immediately only when its approval requirements are already
satisfied, including through `--approve`. Otherwise it remains
`awaiting_approval` for a later `approve` and `execute` sequence. The `--dir`
option overrides the storage directory for every command.

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

## Integration Model

- `guardrails`: provide guardrail hooks that inspect manifest, actor,
  input, scope, and preview before execution.
- `orgs`: resolve actor roles and approval authority before calling
  `approve`.
- `dispatch`: expose dispatch operations as medium/high-risk actions with
  dry-run, target policy, and capture evidence.
- `projects`: represent create/publish/update workflows as composable
  action plans with rollback or compensating-action metadata.
- `events`: receive audit events emitted by `ActionsClient` audit sinks.

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
for medium/high/critical risk. The dashboard should request a server-side
dry-run first, then use the returned run id for explicit confirmation and
approval. It should never execute arbitrary commands from rendered JSON.

## Storage

Default local data directory:

```text
~/.hasna/actions
```

The directory is resolved through `@hasna/paths`. The legacy `~/.hasna/actions`
default stays the effective data home until the store is actually migrated to the
XDG data home (`~/.local/share/hasna/actions` on Linux;
`~/Library/Application Support/Hasna/actions` on macOS) or the operator sets the
data-kind override `HASNA_DATA_HOME`, so an existing local store never becomes
invisible on upgrade. Exact-app overrides win over that default:
`HASNA_ACTIONS_DIR`, then the fallback `HASNA_ACTIONS_HOME`. The CLI `--dir`
option takes precedence over both environment variables.

The default store is SQLite at the effective data home's `actions.db`. On first use it
imports any existing `manifests.json`, `runs.json`, and `audit-events.json`
records once without overwriting newer database records. `JsonActionsStore`
remains available for explicitly configured compatibility use.

The SQLite store is backed by `bun:sqlite`, so it needs the Bun runtime. The
package entry points import and validate manifests under Node as well; pass a
`JsonActionsStore` to `ActionsClient` when running actions outside Bun.

Directory and database permissions are tightened to `0700`/`0600` on a best
effort basis. Data directories that reject `chmod`, such as shared team
directories, container bind mounts, and volumes without POSIX modes, keep
working with whatever permissions they already have.

Local shell executors pass `PATH`, `HOME`, and temp directory variables by
default, plus explicit manifest `env` values. They do not inherit the whole
process environment unless `inheritEnv` is set, so unrelated local secrets are
not casually forwarded to action commands.
