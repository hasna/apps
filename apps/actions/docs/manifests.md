# Manifest Reference

An `ActionManifest` is the portable description of an action. It describes the
contract and safety metadata; an executable `ActionDefinition` must still be
registered in the current process before the SDK can plan or execute it.

See `examples/local-shell.manifest.json` for a complete JSON example and
`examples/project-workflow.ts` for an in-process TypeScript action.

## Fields

| Field | Purpose |
| --- | --- |
| `id`, `name`, `version`, `description` | Stable identity and human context. |
| `inputSchema`, `outputSchema` | JSON Schema-shaped contract metadata. |
| `actor` | Allowed actor types, optional roles, and whether an actor is required. |
| `resource` | Resource type, identifiers, and description. |
| `scope` | `local`, `machine`, `workspace`, `project`, `org`, or `cloud`, plus permissions and boundaries. |
| `riskLevel` | `low`, `medium`, `high`, or `critical`. |
| `requiredApprovals` | `none`, `manual`, or `policy` requirements with optional counts and roles. |
| `idempotency` | Support, requirement, key hint, and retention metadata. |
| `dryRun` | Preview support, default, and notes. |
| `confirmation` | Title, `{{path.to.value}}` summary template, fields, and warnings. |
| `guardrail` | Hook name, fail-closed behavior, and description. |
| `audit` | Advertised event types and input/output/redaction metadata. |
| `evidence` | Evidence requirement, fields, and retention metadata. |
| `rollback` | `none`, `automatic`, `manual`, or `compensating-action` metadata. |
| `executorBindings` | One or more TypeScript, local-shell, MCP, or HTTP binding descriptions. |
| `metadata` | Additional JSON metadata. |

Approval counts default to one for every requirement whose kind is not `none`.
Role-constrained requirements count only approvals from actors with at least one
matching role. Any denial prevents the requirements from being satisfied.

## Executor Bindings

- `typescript` contains a descriptive `ref`. The host must register the actual
  implementation with `createTypeScriptAction` or `defineAction`.
- `local-shell` contains `command`, optional arguments, working directory,
  environment, I/O modes, inheritance policy, and timeout. The CLI and MCP
  server can turn these manifests into executable definitions.
- `mcp` and `http` are contract types only in this release. `ActionsClient` does
  not provide built-in executors for them.

## Runtime Validation

`assertManifest` performs intentionally minimal structural checks. It requires
non-empty `id`, `name`, `version`, and `description` strings, truthy input and
output schemas, and at least one executor binding. It does not fully validate
every nested field against the TypeScript interface or execute the JSON Schemas.

Input and output runtime validation is supplied by optional `SchemaAdapter`
objects on an `ActionDefinition`. Zod schemas work because they expose
`parse(value)`. Without adapters, values are cast to the definition's generic
types rather than validated.

The `audit`, `evidence`, `scope`, actor, and rollback sections are contract and
policy metadata. The client emits its built-in lifecycle events, but it does not
automatically enforce every advertised permission, evidence field, actor type,
or arbitrary audit event name. Host applications should enforce those policies
with input adapters, guardrail hooks, approval authorities, and audit sinks.
