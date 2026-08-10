# `@hasna/todos-ai`

Optional AI runtime companion for `@hasna/todos`. The root Todos package owns
the provider-neutral protocol and CLI. This package implements that protocol,
keeps provider SDKs outside the root package, and currently supplies a Groq
adapter.

## Requirements

- Node.js 22 or newer
- `@hasna/todos` `>=0.15.22 <1`
- `GROQ_API_KEY` for live Groq requests

```bash
bun add @hasna/todos @hasna/todos-ai
```

## Public exports

| Export | Purpose |
|---|---|
| `@hasna/todos-ai` | Runtime factory, neutral orchestration types, and Groq adapter exports |
| `@hasna/todos-ai/runtime` | Protocol-v1 runtime constant and factory loaded by `@hasna/todos` |
| `@hasna/todos-ai/evaluation` | Deterministic no-network corpus, runner, and evaluator |
| `@hasna/todos-ai/groq` | Groq adapter and provider-loader construction |
| `@hasna/todos-ai/smoke` | Credential-safe opt-in smoke helper |

The runtime entrypoint exports:

```ts
export const TODOS_AI_RUNTIME_PROTOCOL_VERSION = 1;
export function createTodosAiRuntime(context) {
  // Returns a TodosAiRuntime compatible with @hasna/todos.
}
```

The implementation imports the public protocol from `@hasna/todos` as types.
It does not define a second public Todos AI protocol.

## Routing

The default provider is `groq` and the default model is
`openai/gpt-oss-120b`. Request-level provider and model values override those
defaults. Providers not present in the injected provider registry fail with a
stable `invalid_configuration` result.

The default runtime checks only whether `GROQ_API_KEY` is present before
creating the Groq adapter. A missing key returns a bounded `provider_error`
without creating a provider or fetch call. Credential values and raw provider
response bodies are never included in results or events.

## Structured output

An `output_schema` always uses two phases:

1. Tool-capable work runs as ordinary text generation, optionally streaming.
2. A separate non-streaming `generateText` call uses `Output.object` with
   strict Groq JSON-schema settings and no tools.

Strict structured output is therefore never combined with tools or streaming.
The same combined abort signal covers provider loading, tool discovery, model
work, tool execution, and the strict finalizer.

## Tool injection

The runtime has a provider-neutral tool source and provider-loader seam:

```ts
import { createTodosAiRuntimeWithDependencies } from "@hasna/todos-ai/runtime";

const runtime = createTodosAiRuntimeWithDependencies(hostContext, {
  providers: {
    fixture: async () => fixtureAdapter,
  },
  toolSource: async ({ request, signal }) => [
    {
      name: "lookup_task",
      description: "Read one Todos task.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      async execute(input, toolContext) {
        // A later bounded-tools package can call Todos here.
        return { input, aborted: signal.aborted, mode: request.authority.write_mode };
      },
    },
  ],
});
```

This seam lets conformance tests exercise tool orchestration without network
access and lets a later bounded-tools package supply real Todos tools without
rewriting the runtime.

## Value-free traces

Injected runtime dependencies may provide `trace(record)` and
`monotonicNow()`. Trace schema version 1 has only these fields:

```text
schema_version run_id provider model phase tool_name terminal_status
error_code retryable elapsed_ms steps input_tokens output_tokens total_tokens
```

Records never include prompts, answers, structured data, tool arguments or
results, clarification fields, approval operations, provider error text,
headers, or credentials. Timing is bounded monotonic elapsed time. Counts are
non-negative safe integers, and the terminal record contains aggregate work
plus structured-finalization usage. A trace sink failure cannot change runtime
authority or the terminal result.

## Deterministic evaluation

`TODOS_AI_EVALUATION_CORPUS` exports eleven named lanes:
`read`, `plan`, `clarification`, `approval`, `denial`, `write`,
`structured_output`, `injection`, `provider_error`, `cancellation`, and
`redaction`.

`runTodosAiEvaluationCorpus()` executes the public runtime with deterministic
fake provider and tool collaborators. It performs no network request. The
evaluator checks exact terminal output, safety, usage, phase/timing, trace
shape, and private-marker omissions. The suite also contains an intentionally
wrong/leaky observation so the evaluator is proven able to fail.

## Live smoke

The smoke command makes no network call unless `--live` is supplied. It limits
the prompt to 4 KiB, the terminal report to 64 KiB, model output to the runtime
token bound, and the run to 30 seconds. It prints only the bounded terminal
result and never logs the API key.

```bash
todos-ai-groq-smoke --live
```

With the source checkout:

```bash
bun run smoke:groq -- --live --prompt "Reply with OK."
```

Use a credential delivery mechanism that places `GROQ_API_KEY` only in the
smoke process environment before running either command. Do not put credential
values in command arguments, shell history, logs, or checked-in files.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

The test suite uses injected adapters and SDK functions. It does not make live
network calls.
