# Adapters

Adapters connect a case to the application under test. `evals run` requires a run-level adapter, although a case may override it with its own `adapter` object.

## HTTP

```bash
evals run dataset.jsonl \
  --adapter http \
  --url http://localhost:3000/api/chat \
  --headers '{"Authorization":"Bearer test"}' \
  --input-path request.message \
  --output-path result.text
```

Defaults:

- Method: `POST`.
- Request body: `{ "messages": [{ "role": "user", "content": input }] }`.
- Multi-turn body: `{ "messages": turns }`.
- Header: `Content-Type: application/json`, followed by configured headers.
- Response mode: JSON.

With `inputPath`, a single-turn input is written into a nested object using dot notation. JSON responses use `outputPath` when provided; otherwise extraction tries `choices.0.message.content`, `message.content`, `content`, `output`, and `text`, then falls back to the serialized response object. `responseMode: "text"` returns the raw response body. Non-2xx responses and fetch failures become adapter errors.

The path reader supports dotted keys and array notation such as `messages[-1]`. The request path writer supports dotted object keys, not array notation.

## Anthropic

```bash
evals run dataset.jsonl --adapter anthropic --model claude-sonnet-4-6
```

Uses `ANTHROPIC_API_KEY` unless `--api-key` or `--api-key-env` supplies a key. `maxTokens` defaults to `4096`. Text blocks are joined with newlines, tool-use blocks become assertion-visible tool calls, and token/cost metadata is recorded. The built-in cost estimate uses $3/million input tokens and $15/million output tokens for every Anthropic model.

## OpenAI-compatible

```bash
evals run dataset.jsonl \
  --adapter openai \
  --model gpt-4o \
  --base-url http://localhost:11434/v1
```

Uses `OPENAI_API_KEY` unless overridden. `--base-url` is preferred; `--url` remains an alias for the OpenAI adapter. Messages include the optional system prompt followed by either the transcript or the single input. The first choice's message content and tool calls are returned. Token usage is recorded; cost is not calculated by this adapter.

## MCP tool

```bash
evals run dataset.jsonl \
  --adapter mcp \
  --mcp-command "node server.js" \
  --tool search
```

The CLI splits `--mcp-command` on spaces and starts the server over stdio. It calls the selected tool with `{ "input": caseInput }`. SDK case configs can instead provide a command array and `inputMapping`; mapping values equal to `{{input}}` are replaced with the input. Text content blocks are joined with newlines. The default timeout is 30 seconds.

## Function

```bash
evals run dataset.jsonl --adapter function --module ./handler.ts --export evaluate
```

The module is imported dynamically. The selected export defaults to `default`, receives the input string, and may return a value or promise. Strings are returned unchanged; other values are JSON-serialized. Multi-turn transcripts are not passed to function adapters.

## CLI command

```bash
evals run dataset.jsonl --adapter cli --command "my-tool '{{input}}'"
```

The command runs as `bash -c`. The first `{{input}}` placeholder is replaced and the same input is also written to stdin. Stdout is trimmed and used as output; a non-zero exit becomes an adapter error. The default timeout is 30 seconds. SDK configs may add environment variables with `env`.

## Per-case overrides

Dataset cases can embed the full SDK form:

```json
{
  "id": "local-handler",
  "input": "hello",
  "adapter": {
    "type": "function",
    "modulePath": "/absolute/path/to/handler.ts",
    "exportName": "default"
  },
  "assertions": [{ "type": "contains", "value": "hello" }]
}
```

CLI flags create the run-level adapter. Embedded adapter objects use the TypeScript property names documented in [the SDK reference](sdk.md).
