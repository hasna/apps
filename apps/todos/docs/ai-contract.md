# Todos AI Contract

`todos ai` is a provider-neutral host contract. The root `@hasna/todos`
package parses input, resolves authority, validates protocol records, and
formats output. An optional companion runtime performs model and tool work.
The root package does not depend on a provider SDK, a provider endpoint, or a
provider credential.

## Command Grammar

```text
todos ai [prompt...]
  [--input-json <json>]
  [--output-schema <json>]
  [--var <key=value>]...
  [--provider <name>]
  [--model <name>]
  [--profile <name>]
  [--format <text|json|stream-json>]
  [--max-steps <1..20>]
  [--timeout-ms <1000..600000>]
  [--write-mode <read-only|plan|execute>]
  [--approval-mode <deny|required|prompt|existing>]
  [--approval <reference>]...
  [--dry-run]
  [--resume <run-id>]
  [--non-interactive]
```

The positional prompt is the prompt when it is non-empty. With no positional
prompt, non-TTY stdin is read once, bounded to 1 MiB, and used as the prompt.
An empty interactive input returns `needs_input`. Empty non-interactive input
is an `invalid_input` usage failure and never invokes the optional runtime.

`--input-json` accepts any JSON value and defaults to `null`.
`--output-schema` accepts a JSON object and defaults to `null`. `--var` is
repeatable and preserves everything after the first `=` as the value.
Variable keys must be unique, must match
`[A-Za-z_][A-Za-z0-9_.-]{0,63}`, and must not be credential-shaped. Runtime
credentials belong in the companion runtime's secret configuration, never in
the request variables.

`--resume` supplies the prior runtime run ID and may be used with an empty
prompt. Every event and the terminal result must preserve that exact run ID.
`--non-interactive` disables runtime prompting even when the process has a
TTY.

AI command usage errors honor an explicit `--format json` and the global
`--json` option. They emit exactly one failed result envelope and exit `2`,
without an additional Commander error document or stack trace.

## Configuration

Configuration resolves one field at a time in this order:

```text
CLI option > TODOS_AI_* environment > stored AI config > contract default
```

The stored keys are under the `ai` object in
`~/.hasna/todos/config.json`.

| Setting | CLI | Environment | Stored key | Default |
|---|---|---|---|---|
| Provider route | `--provider` | `TODOS_AI_PROVIDER` | `provider` | `null` |
| Model route | `--model` | `TODOS_AI_MODEL` | `model` | `null` |
| Runtime profile | `--profile` | `TODOS_AI_PROFILE` | `profile` | `null` |
| Output format | `--format` | `TODOS_AI_FORMAT` | `format` | `text` |
| Step limit | `--max-steps` | `TODOS_AI_MAX_STEPS` | `max_steps` | `8` |
| Timeout | `--timeout-ms` | `TODOS_AI_TIMEOUT_MS` | `timeout_ms` | `60000` |
| Write authority | `--write-mode` | `TODOS_AI_WRITE_MODE` | `write_mode` | `read-only` |
| Approval behavior | `--approval-mode` | `TODOS_AI_APPROVAL_MODE` | `approval_mode` | mode-dependent |

Empty strings do not override a lower-precedence string setting. Invalid
enums and out-of-range integers fail before runtime loading.

## Request Envelope

The host sends protocol version 1 requests:

```json
{
  "schema_version": 1,
  "prompt": "Summarize the ready work",
  "input": null,
  "variables": {
    "project": "example"
  },
  "output_schema": null,
  "provider": null,
  "model": null,
  "profile": null,
  "format": "json",
  "interactive": false,
  "context": {
    "project": null,
    "agent": null,
    "session": null
  },
  "authority": {
    "write_mode": "read-only",
    "approval_mode": "deny",
    "approval_refs": [],
    "dry_run": false
  },
  "limits": {
    "max_steps": 8,
    "timeout_ms": 60000
  },
  "resume_run_id": null
}
```

Provider, model, and profile are opaque routing values. They do not change the
host protocol or grant authority.

## Result Envelope

Every invocation has exactly one terminal result:

```json
{
  "schema_version": 1,
  "run_id": "run-id",
  "status": "answered",
  "answer": "Two tasks are ready.",
  "data": null,
  "steps": 1,
  "usage": {
    "input_tokens": 10,
    "output_tokens": 6,
    "total_tokens": 16
  },
  "pending_input": null,
  "pending_approval": null,
  "error": null
}
```

| Status | Required terminal meaning |
|---|---|
| `answered` | A response or non-mutating plan is complete. |
| `completed` | One `update_task` mutation passed authoritative readback verification. |
| `needs_input` | `pending_input` describes the missing fields. |
| `needs_approval` | `pending_approval` describes the exact proposed operations. |
| `failed` | `error` carries a stable code, message, retryability, and optional details. |

`answered` and `completed` must not carry pending input, pending approval, or
an error. `needs_input` and `needs_approval` must carry their matching pending
object. `failed` must carry an error. A runtime result that violates these
terminal semantics is `runtime_invalid_result`.

When `output_schema` is present, the companion runtime performs work first and
then uses a separate no-tool, non-streaming provider finalizer. Provider-side
structured-output validation is not trusted as the success gate. The runtime
independently compiles the requested JSON Schema before provider work, then
normalizes the finalizer data to bounded stable JSON and validates it against
that compiled schema. An invalid schema or non-matching provider result returns
`schema_error`; `answer` and `data` are `null`, and the runtime does not fall
back to the unvalidated draft answer or provider prose.

Results and events are stable JSON data objects. Shape-changing `toJSON`
methods, symbol keys, accessors, functions, `undefined`, and other non-JSON
values are rejected before any record is serialized.

The three output formats carry the same terminal result and exit code:

- `text` prints a human-readable view of the terminal result.
- `json` prints the terminal result as one JSON document.
- `stream-json` prints zero or more event records followed by exactly one
  result record.

## Stream Events

`stream-json` is newline-delimited JSON. Every non-empty stdout line is one
complete JSON record. Event records use:

```json
{
  "schema_version": 1,
  "kind": "event",
  "event": {
    "schema_version": 1,
    "run_id": "run-id",
    "sequence": 0,
    "type": "run.started",
    "timestamp": "2026-08-09T00:00:00.000Z",
    "data": {}
  }
}
```

The supported event types are:

- `run.started`
- `run.progress`
- `text.delta`
- `tool.started`
- `tool.completed`
- `input.required`
- `approval.required`

Events must satisfy the schema, use the current run ID, and have strictly
increasing sequence numbers. An invalid event fails the run. The final line is
the only result record:

```json
{
  "schema_version": 1,
  "kind": "result",
  "result": {
    "schema_version": 1,
    "run_id": "run-id",
    "status": "answered",
    "answer": "Done.",
    "data": null,
    "steps": 1,
    "usage": null,
    "pending_input": null,
    "pending_approval": null,
    "error": null
  }
}
```

No record may follow the terminal result. A malformed synchronous, timer, or
otherwise detached emission produces exactly one failed terminal result and
exit `6`; it must not escape as an uncaught exception or stack trace.

## Safety Rules

`read-only` with approval mode `deny` is the default. A runtime must treat the
authority object as an upper bound, not as a request to use all available
authority.

| Write mode | Allowed approval modes | Mutation authority |
|---|---|---|
| `read-only` | `deny` | None |
| `plan` | `deny` | None; proposed operations may be returned only as data |
| `execute` | `required`, `prompt`, or `existing` | Only within the selected approval contract |

`--dry-run` always narrows authority to `plan` plus `deny`. It never upgrades
stored or environment authority. `--dry-run --write-mode execute` is invalid.
Approval references are accepted only with approval mode `existing`, and that
mode requires at least one reference.

Interactive `execute` defaults to approval mode `prompt`. Non-interactive
`execute` defaults to `required`; approval mode `prompt` is invalid without a
TTY. Unsupported write, approval, and interactivity combinations fail before
runtime loading.

## Host Tools And Authority

The host, not the prompt or provider, fixes the reachable tool set. Prompt
text, JSON input, variables, `--profile`, provider selection, and model
selection never grant tool or write authority.

The package-owned host tools in this contract are:

| Tool | Effect | Availability |
|---|---|---|
| `get_task` | Read | Host access profile plus workspace read permission |
| `list_tasks` | Read | Host access profile plus workspace list permission |
| `list_projects` | Read | Host access profile plus workspace list permission |
| `list_plans` | Read | Host access profile plus workspace list permission |
| `request_input` | Control only | Always; it performs no authoritative mutation |
| `update_task` | Write | `plan` or eligible `execute`, a known host profile allowing `update_task`, and workspace write permission |

No create, delete, bulk, admin, shell, arbitrary command, or arbitrary HTTP
tool is exposed by this slice. Unknown host profiles, untrusted workspaces, and
the default minimal host profile do not expose `update_task`. The runtime
profile in the AI request is routing data and does not widen this host policy.

`request_input` accepts one bounded prompt and 1 to 16 unique bounded field
names. It raises a typed control signal, emits `input.required`, and returns
`needs_input` with the same `pending_input` in text, JSON, and stream JSON. It
does not write authoritative state.

`update_task` accepts exactly:

```json
{
  "task_id": "one exact UUID",
  "expected_version": 3,
  "patch": {
    "title": "New title"
  },
  "idempotency_key": "caller-stable-key"
}
```

The patch allowlist is `title`, `description`, `status`, `priority`,
`assigned_to`, `tags`, and `due_at`. The host rejects non-UUID or ambiguous
targets, absent or stale versions, unsupported fields, no-op patches,
accessors, custom prototypes, cycles, non-finite numbers, and other unstable
JSON before mutation.

In `plan` mode, `update_task` reads and version-checks the exact task and
returns a bounded `todos.ai.update_task.v1` proposal with `applied=false`. It
never writes. In `execute` mode:

1. `required` and `prompt` stop with `needs_approval`, emit
   `approval.required`, and include a bounded operation containing the exact
   task, expected version, changed field names, and payload digest.
2. `existing` requires exactly one matching approval reference. Local
   execution verifies an approved, non-expired durable approval gate for that
   exact task and deterministic operation reference. Remote execution fails
   closed unless the host supplies an authority verifier. A nonempty arbitrary
   reference is not approval.
3. The host preflights the exact task and version, checks abort immediately
   before mutation, applies one optimistic versioned update, performs an
   authoritative GET/readback, and verifies the task ID, incremented version,
   and every applied patch field.
4. Only the verified receipt can produce `status=completed`. Execute-mode
   provider prose without that receipt remains `answered`. If the provider
   fails after a verified receipt, the runtime returns the verified completion
   rather than an unverified provider failure.

Idempotency is scoped to one runtime run. Repeating the same key with the
identical payload reuses the first result and does not apply the update twice.
Reusing the key with a different payload fails before mutation. An abort before
the write leaves authoritative state unchanged. Once a mutation attempt begins,
the host completes authoritative readback reconciliation; it does not claim a
rollback guarantee that the local or HTTP adapter cannot prove.

Typed `needs_input` and `needs_approval` signals are preserved through the
runtime adapter and the orchestrator. Raw tool or provider errors are not
placed in terminal envelopes.

## Runtime Compatibility

The host dynamically imports the optional
`@hasna/todos-ai/runtime` entrypoint. A compatible module exports:

```ts
export const TODOS_AI_RUNTIME_PROTOCOL_VERSION = 1;

export function createTodosAiRuntime(context: {
  package_name: "@hasna/todos";
  package_version: string;
  protocol_version: 1;
}) {
  return {
    async run(request, { signal, emit }) {
      // Return one validated terminal result.
    },
  };
}
```

The companion may select a provider internally, but provider dependencies,
endpoints, and credentials stay outside the root package. A missing optional
runtime maps to `runtime_unavailable`. A missing factory or a protocol version
mismatch maps to `runtime_incompatible`. A malformed terminal result maps to
`runtime_invalid_result`.

The host supplies an `AbortSignal`. The deadline covers runtime module import,
runtime factory creation, and execution. Once timeout or interruption aborts
the operation, the host must not call `runtime.run`, even if a delayed import
or factory resolves later. Timeout aborts map to `timeout`; process interrupts
map to `interrupted`. Other runtime failures map to a stable error envelope
without exposing provider credentials or raw secret material.

## Value-Free Observability

The companion runtime may emit trace schema version 1 through an injected
trace sink. This trace is separate from payload-bearing stream events and has
an exact, closed field set:

| Field | Meaning |
|---|---|
| `schema_version` | Trace schema version, currently `1` |
| `run_id` | Bounded run identifier |
| `provider` | Bounded provider identifier |
| `model` | Bounded model identifier |
| `phase` | Work, tool, finalization, or terminal phase |
| `tool_name` | Bounded tool name, or `null` |
| `terminal_status` | Terminal result status, otherwise `null` |
| `error_code` | Stable terminal error code, otherwise `null` |
| `retryable` | Terminal retryability, otherwise `null` |
| `elapsed_ms` | Bounded elapsed time from an injected monotonic clock |
| `steps` | Non-negative safe aggregate step count |
| `input_tokens` | Non-negative safe aggregate input-token count |
| `output_tokens` | Non-negative safe aggregate output-token count |
| `total_tokens` | Non-negative safe aggregate total-token count |

The allowed phases are `work.started`, `tool.started`, `tool.completed`,
`work.completed`, `finalize.started`, `finalize.completed`, and `terminal`.
Exactly one terminal trace is last. Its usage includes work plus
structured-output finalization.

Trace records never contain prompt or answer text, structured or private
payloads, tool arguments or results, clarification fields, approval
operations, provider error text, headers, or credential values. The trace type
has no arbitrary metadata map. Invalid or secret-shaped identifiers are
replaced with bounded fallback identifiers. A trace sink failure cannot change
authority, mutation behavior, or the terminal result.

## Deterministic Evaluation Corpus

The companion exports a no-network runner over the real public runtime. It
uses deterministic fake provider and tool collaborators rather than a second
runtime implementation. The named fixture lanes are exactly:

```text
read
plan
clarification
approval
denial
write
structured_output
injection
provider_error
cancellation
redaction
```

Each fixture has a stable ID and name plus exact terminal output, error class,
safety, usage, and trace invariants. The injection fixture keeps host authority
read-only, exposes no write tool, bypasses no approval, and mutates nothing.
The redaction fixture places known-positive private markers in prompts, tool
arguments and results, provider errors and headers, clarification data,
approval operations, and answer text, then proves none appears in serialized
traces. Safe provider, model, tool, run, status, timing, and usage metadata is
the negative control. An intentionally wrong and leaky observation proves the
evaluator can fail.

## Failure And Retry Semantics

Failures are finite typed results. The runtime does not sleep, automatically
retry, or loop on a failure.

| Path | Error code | Retryable |
|---|---|---|
| Invalid route or runtime configuration | `invalid_configuration` | `false` |
| Missing provider credentials | `provider_error` | `false` |
| Provider or rate failure | `provider_error` | Explicit adapter value |
| Deadline | `timeout` | `true` |
| Caller cancellation | `interrupted` | `false` |
| Structured-output validation | `schema_error` | `false` |
| Tool execution | `tool_error` | `false` |
| Runtime invariant or event failure | `internal_error` | `false` |

Retryability is machine-readable guidance to the caller, not permission for an
automatic retry. Provider calls are single-attempt. A verified write receipt
still takes precedence over a later provider, timeout, cancellation, schema,
tool, configuration, or internal failure.

## Exit Codes

| Exit | Meaning |
|---:|---|
| `0` | `answered` or `completed` |
| `2` | Invalid input or configuration |
| `3` | `needs_input` |
| `4` | `needs_approval` |
| `5` | Optional runtime unavailable or incompatible |
| `6` | Invalid runtime result or other stable runtime failure |
| `124` | Timeout |
| `130` | Interrupted |

Text, JSON, and stream JSON must return the same exit for the same terminal
result.
