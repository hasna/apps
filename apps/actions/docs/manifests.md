# Manifest contract

`ActionManifest` is the portable description stored by the SDK, CLI, and MCP
server. It describes an action and its policy metadata; an executor definition
supplies the in-process behavior.

The complete example in [`examples/local-shell.manifest.json`](../examples/local-shell.manifest.json)
is executable by the CLI. The TypeScript examples in [`examples/`](../examples)
show manifests paired with in-process executors.

## Required top-level fields

| Field | Type | Current meaning |
| --- | --- | --- |
| `id` | `string` | Stable action identifier. |
| `name` | `string` | Human label. |
| `version` | `string` | Action contract version. |
| `description` | `string` | Human description. |
| `inputSchema` | `JsonSchema` | Declared input JSON Schema. It is not automatically evaluated. |
| `outputSchema` | `JsonSchema` | Declared output JSON Schema. It is not automatically evaluated. |
| `actor` | `ActorMetadata` | Allowed actor types, optional roles, and notes. Declarative. |
| `resource` | `ResourceMetadata` | Resource type and identifier field names or project identifiers. |
| `scope` | `ScopeMetadata` | Scope level, permissions, boundaries, and description. Declarative. |
| `riskLevel` | `low \| medium \| high \| critical` | Risk classification used by presentation and dashboard boundaries. |
| `requiredApprovals` | `ApprovalRequirement[]` | Approval requirements enforced before execution. |
| `idempotency` | `IdempotencySpec` | Whether keys are supported/required and optional descriptive metadata. |
| `dryRun` | `DryRunSpec` | Whether dry-run is advertised and its default. |
| `confirmation` | `ConfirmationSpec` | Confirmation title, optional template, fields, and warnings. |
| `audit` | `AuditSpec` | Declared event types and input/output/redaction metadata. |
| `evidence` | `EvidenceSpec` | Declared evidence requirement, fields, and retention. |
| `rollback` | `RollbackSpec` | `none`, `automatic`, `manual`, or `compensating-action` metadata. |
| `executorBindings` | `ActionExecutorBinding[]` | One or more TypeScript, local-shell, MCP, or HTTP binding descriptions. |
| `guardrail` | `GuardrailSpec` | Optional hook name, fail-closed flag, and description. |
| `metadata` | `JsonObject` | Optional application metadata. |

## Approval behavior

An approval requirement has kind `none`, `manual`, or `policy`, plus optional
`count`, `roles`, `reason`, and `policy`. At runtime, `none` needs no approval;
the other kinds require at least one approval when `count` is omitted or less
than one. A roles list requires an approving actor to have at least one listed
role. The runtime does not invoke a policy engine based on `kind: "policy"` or
the `policy` string; the host must perform that integration.

## Dry-run and guardrails

`dryRun.default` is used when an SDK or MCP request omits `dryRun`. The CLI
`run` command always supplies an explicit boolean based on `--dry-run`.
`dryRun.supported` is currently descriptive: the client does not reject a
dry-run request when it is false.

If a manifest has `guardrail.failClosed: true` and the `ActionsClient` has no
guardrail hooks, preview is denied. Configured hooks run during preview and
again before execution. A deny result stops the run, a warning is recorded and
allows it to continue, and allow continues normally. Hook selection by the
manifest's `guardrail.hook` name is the host's responsibility; the client calls
every configured hook.

## Executor bindings

The binding union currently contains:

- `typescript`: a descriptive `ref`. The host must register the corresponding
  `ActionDefinition` in the same process.
- `local-shell`: an executable command, arguments, cwd, environment behavior,
  input/output modes, and optional timeout. The bundled executor implements it.
- `mcp`: a descriptive server and tool pair. There is no bundled MCP executor.
- `http`: a descriptive `POST`, `PUT`, or `PATCH` endpoint. There is no bundled
  HTTP executor.

Stored manifests do not persist JavaScript functions. TypeScript actions must
be registered again in every process that plans, previews, or executes them.
The CLI supports local-shell manifests only. The MCP registration tool stores
all manifest kinds but only creates a working executor for local-shell bindings.

## Current runtime validation

`assertManifest`, `actions manifests validate`, CLI registration, and MCP
registration perform only these structural checks:

1. `id`, `name`, `version`, and `description` are non-empty strings.
2. `inputSchema` and `outputSchema` are truthy.
3. `executorBindings` is a non-empty array.

They do not validate the rest of the manifest shape, evaluate JSON Schema,
enforce actor types or scope permissions, verify event names, check referenced
executors, or detect credentials. TypeScript definitions may provide `input`
and `output` `SchemaAdapter` objects (for example Zod schemas); those adapters
are evaluated before execution. Local-shell definitions do not automatically
evaluate the declared JSON Schemas.

## Confirmation templates

When `confirmation.summaryTemplate` exists, the client replaces
`{{ dotted.path }}` placeholders from object input. Missing paths become an
empty string. Without a template, the confirmation title is used.

## Audit and evidence metadata

The client always creates lifecycle events for the operations it performs; the
manifest's `audit.eventTypes` list is not used to suppress or select them.
`includeInput`, `includeOutput`, and `redactedFields` are currently declarative
metadata, not automatic serialization or redaction controls. Request evidence
is copied into the run, while executor-returned evidence is not automatically
merged into the run by the current client.

Do not place credentials in any manifest field. See [Storage and security](storage.md).
