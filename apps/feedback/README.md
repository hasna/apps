# Open Feedback

Reusable feedback collection for Hasna-coded apps.

Open Feedback provides a small HTTP API, TypeScript SDK, CLI, MCP server, and local JSONL storage so apps can collect product feedback without standing up a database first. Production deployments can inject a cloud-backed `FeedbackStore` adapter while keeping local operation unchanged. The local project slug is `open-feedback`; the GitHub repository is `hasna/feedback`.

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
feedback shipped <id> --changelog-ref open-todos@1.2.3
feedback sync-tasks
feedback stats
feedback export --format jsonl --until 2026-12-31
```

Use `--api-url` and `--token` to target a remote Open Feedback API instead of local JSONL storage, or set `FEEDBACK_API_URL` / `FEEDBACK_API_TOKEN` once so every command uses the shared deployment without retyping the flags. An explicit flag always beats the environment. The CLI does not open database connections or create cloud resources itself.

`feedback shipped <id> --changelog-ref <ref>` marks feedback as shipped, records the changelog-entry linkage (`changelogRef`, `shippedAt`), and emits the `feedback.triaged` notification event with disposition `shipped`. It works against both the local store and a remote API (`--api-url`/`--token`, or `FEEDBACK_API_URL`). `feedback status <id> shipped` also moves the status but records no `changelogRef` — prefer `shipped` so the link between a report and the thing that resolved it survives.

`feedback doctor` exits non-zero when it reports `ok: false`, so it can gate a health check or a loop.

### Closing the loop: feedback → task → PR

Feedback is only useful if something picks it up. On the create path, Open Feedback files a task in a task tracker and records the link on the feedback item as `taskRef`:

```bash
feedback submit "Export button 500s for orgs over 10k members" --app my-app --kind bug --severity high
# -> stores the feedback AND creates a task titled
#    "[feedback:my-app] Export button 500s for orgs over 10k members"
```

The task body carries the feedback id, the reporter context, and the commands to read the original report and close it out, so an executor picking the task up has everything it needs.

This runs in-process rather than through an out-of-process event subscriber on purpose: channel configuration is machine-local state a fresh install does not inherit, so a wire that lives there is invisible when it is missing and silent when it fails.

| variable | default | meaning |
| --- | --- | --- |
| `FEEDBACK_TASK_SINK` | `auto` | `auto` (use `todos` when its CLI is on `PATH`, otherwise do nothing), `todos`, `command`, or `none` |
| `FEEDBACK_TASK_PROJECT` | — | project every task is filed under |
| `FEEDBACK_TASK_PROJECT_MAP` | — | JSON `{"<appId>": "<project>"}`, per-app routing; beats `FEEDBACK_TASK_PROJECT` |
| `FEEDBACK_TASK_PRIORITY_MAP` | severity→same name | JSON overriding the severity→priority mapping |
| `FEEDBACK_TASK_TAGS` | — | comma-separated extra tags |
| `FEEDBACK_TASK_BIN` | `todos` | task CLI name or path |
| `FEEDBACK_TASK_TIMEOUT_MS` | `15000` | how long task creation may block capture before it is killed and recorded as a failure |
| `FEEDBACK_TASK_COMMAND` | — | with `FEEDBACK_TASK_SINK=command`, the command to run; it receives `{"feedback":…,"task":…}` on stdin and must print JSON containing an `id` |

`auto` is deliberately quiet: an install without a task CLI writes feedback and creates nothing, rather than failing every submit.

**Capture is never held hostage by the tracker.** The report is written to storage first, and task creation runs after it with a timeout — a tracker that is down, slow, or hung costs you a task, never a report. If filing fails, the error is recorded on the item as `taskError` (truncated to the schema bound), `submit` warns and exits non-zero, and `feedback sync-tasks` retries:

```bash
feedback sync-tasks   # -> {"sinkConfigured":true,"created":2,"failed":0,"skipped":11,"uncertain":0,"remaining":0,"errors":[]}
```

`sync-tasks` distinguishes two kinds of unlinked feedback, because they are not equally safe to retry:

- a recorded `taskError` means the attempt is **known** to have failed, so it is retried automatically;
- an attempt with no recorded outcome (a crash or timeout between "task created" and "link written") is reported as **`uncertain`** and skipped, because a task may already exist and re-filing would duplicate it. Use `--retry-uncertain` to force it after checking.

`--limit` reports what it did not get to as `remaining`, so a partial run never reads as a complete one.

### Storage shape

The JSONL file is an **append-only log** with two kinds of record:

- a **full item** — the whole feedback object, written once when it is submitted (and again when the log is compacted);
- a **linkage patch** — `{"patch":"task","id":…,"taskRef":…}`, carrying only the task fields, where `null` clears a field.

Reading folds the log by id: a full record replaces, a patch **merges field by field**. Task linkage is written as a patch rather than as a fresh snapshot of the whole item, and that distinction is load-bearing: the snapshot would be taken *before* task creation, so replaying it would resurrect the pre-task status and silently erase a `shipped` (and its `changelogRef`) that landed while the task was being created.

Linkage is never written by rewriting the file. Rewriting on the create path is O(n) under the data lock and, under concurrency, drops writes outright. `feedback status` and `feedback shipped` compact the log back to one full record per item.

A patch is small, but an untriaged store still carries roughly one extra record per item until something compacts it, and reads scale with records rather than items. That is fine at the scale this is built for; it is worth knowing before pointing it at a very large backlog.

### Distribution events

Feedback stores emit `feedback.created` and `feedback.triaged` event envelopes (distribution event catalog, contract `hasna.feedback.v1`) through `@hasna/events` on the create/triage paths. Pass `eventSink: null` to `LocalFeedbackStore` to disable emission, or provide your own `FeedbackEventSink`. The default sink respects `HASNA_EVENTS_DIR`.

`feedback doctor` checks the package version, selected storage runtime, local data file path and permissions when local mode is active, the resolved task sink, the configured remote URL, token configuration, cloud configuration presence, and whether the expected binaries are on `PATH`. Diagnostics only report whether sensitive settings are configured; they do not print token, DSN, ARN, or secret values. It exits non-zero when `ok` is false.

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
- `feedback_diagnostics`

Feedback submitted through the MCP server goes through the same store, so it creates a task and records `taskRef` exactly as the CLI does.

## Storage

By default, Open Feedback runs in local JSONL mode and writes to:

```text
~/.hasna/feedback/feedback.jsonl
```

Override the directory with `FEEDBACK_DATA_DIR`.

Set `FEEDBACK_STORE=cloud` only in a host runtime that injects a cloud-backed `FeedbackStore` adapter:

```ts
import { createFeedbackHandler, type FeedbackStore } from "@hasna/feedback";

const cloudStore: FeedbackStore = createYourFeedbackStoreAdapter();
const handler = createFeedbackHandler({
  store: cloudStore,
  apiToken: process.env.FEEDBACK_API_TOKEN,
});
```

`@hasna/feedback` does not create databases, run migrations, provision AWS/RDS resources, create secrets, or send notifications. Without an injected adapter, cloud mode fails closed with a clear diagnostic blocker. Optional readiness settings such as `FEEDBACK_CLOUD_PROVIDER`, `FEEDBACK_CLOUD_DATABASE_URL`, `FEEDBACK_CLOUD_RESOURCE_ARN`, `FEEDBACK_CLOUD_SECRET_ARN`, and `FEEDBACK_CLOUD_TABLE` are reported as configured/not configured only.

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
