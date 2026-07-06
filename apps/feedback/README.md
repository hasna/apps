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
feedback-serve --port 8787
```

## HTTP API

Start the API:

```bash
feedback serve --host 127.0.0.1 --port 8787
```

Set `FEEDBACK_API_TOKEN` to require bearer-token auth for every API request.
Shared deployments should use scoped tokens instead of one broad token:

- submit: accepts browser or app-server submissions.
- read: lists feedback, reads one item, and reads stats.
- triage: updates status.
- export: streams JSONL exports.

For public collection, enable public submit only at the app backend or feedback
service boundary and keep read, triage, and export scoped. In shared deployment
mode, non-local read, triage, and export routes fail closed when their scoped
token is missing. Submit requests are still checked for spam-like payloads,
duplicate recent submissions, and per-client rate limits before storage writes.

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

Browser apps can collect standard route/device context without a UI dependency:

```ts
import { collectBrowserFeedbackContext } from "@hasna/feedback/browser";

const context = collectBrowserFeedbackContext({
  version: import.meta.env.VITE_APP_VERSION,
  environment: import.meta.env.MODE,
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
feedback doctor
feedback submit "Add export history" --app my-app --kind idea --tag reports --route /reports --app-version 1.2.3 --env production
feedback list --app my-app --search export --since 2026-01-01 --limit 20
feedback show <id>
feedback status <id> triaged
feedback stats
feedback export --format jsonl --until 2026-12-31
```

Use `--api-url` and `--token` to target a remote Open Feedback API instead of local JSONL storage.

`feedback doctor` checks the package version, local data file path, basic storage permissions, token configuration, and whether the expected binaries are on `PATH`.

### Terminal Slash Commands

For terminal or agent slash-command style workflows, wire the command body to `feedback submit` and pass the current app slug:

```bash
# /feedback Add an activity filter to the inbox view
feedback submit "Add an activity filter to the inbox view" --app my-app --kind idea --tag slash-command

# /bug Export fails after picking a date range
feedback submit "Export fails after picking a date range" --app my-app --kind bug --severity high
```

The slash-command wrapper should provide `--api-url` and `--token` when feedback belongs in a shared deployment.

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
- `export_feedback`

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
