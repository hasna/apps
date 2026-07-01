# Open Feedback

Reusable feedback collection for Hasna-coded apps.

Open Feedback provides a small HTTP API, TypeScript SDK, CLI, MCP server, and local JSONL storage so apps can collect product feedback without standing up a database first. The local project slug is `open-feedback`; the GitHub repository is `hasna/feedback`.

## Install

```bash
bun add @hasna/feedback
```

For local CLI usage:

```bash
bunx @hasna/feedback init
feedback serve --port 8787
```

## HTTP API

Start the API:

```bash
feedback serve --host 127.0.0.1 --port 8787
```

Set `FEEDBACK_API_TOKEN` to require bearer-token auth for API requests:

```bash
FEEDBACK_API_TOKEN="$YOUR_TOKEN" feedback serve
```

Submit feedback:

```bash
curl -X POST http://127.0.0.1:8787/v1/feedback \
  -H 'content-type: application/json' \
  -d '{
    "appId": "my-app",
    "message": "The billing screen should show the invoice PDF sooner.",
    "kind": "idea",
    "tags": ["billing"]
  }'
```

Useful endpoints:

- `GET /health`
- `POST /v1/feedback`
- `GET /v1/feedback?appId=my-app&limit=50`
- `GET /v1/feedback/:id`
- `PATCH /v1/feedback/:id` with `{ "status": "triaged" }`
- `GET /v1/stats`
- `GET /v1/export.jsonl`

## SDK

```ts
import { createFeedbackClient } from "@hasna/feedback";

const feedback = createFeedbackClient({
  baseUrl: "http://127.0.0.1:8787",
  token: process.env.FEEDBACK_API_TOKEN,
});

await feedback.submit({
  appId: "my-app",
  message: "Export fails after selecting a date range.",
  kind: "bug",
  severity: "high",
  context: {
    route: "/reports",
    version: "2026.07.01",
  },
});
```

For in-process server apps, use local storage directly:

```ts
import { LocalFeedbackStore } from "@hasna/feedback/storage";

const store = new LocalFeedbackStore();
await store.createFeedback({
  appId: "my-app",
  message: "Add CSV export.",
});
```

## CLI

```bash
feedback init
feedback submit "Add export history" --app my-app --kind idea --tag reports
feedback list --app my-app --limit 20
feedback show <id>
feedback status <id> triaged
feedback stats
feedback export --format jsonl
```

Use `--api-url` and `--token` to target a remote Open Feedback API instead of local JSONL storage.

## MCP

Run the MCP server:

```bash
feedback-mcp
```

Available tools:

- `submit_feedback`
- `list_feedback`
- `get_feedback`
- `update_feedback_status`
- `feedback_stats`

## Storage

By default, Open Feedback writes JSONL to:

```text
~/.hasna/feedback/feedback.jsonl
```

Override the directory with `FEEDBACK_DATA_DIR`.

## App Integration

See [docs/app-integration.md](docs/app-integration.md) for browser, server, CLI, and MCP integration examples.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## Security

Open Feedback redacts common credential patterns and sensitive metadata keys before storing feedback. Treat feedback exports as potentially sensitive product data. Do not commit feedback JSONL files or API tokens.

