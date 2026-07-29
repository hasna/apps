# MCP Reference

Run the MCP server over standard input/output:

```bash
feedback-mcp
```

The binary supports `-V`/`--version` and `-h`/`--help`. It has no other command
line options.

## Storage Runtime

The standalone server uses local JSONL storage by default. It honors
`FEEDBACK_DATA_DIR`, `FEEDBACK_STORE`, and `FEEDBACK_STORAGE_BACKEND`.

Cloud mode requires a host application to inject a `FeedbackStore` when it
calls `createFeedbackMcpServer()`, `buildServer()`, or
`registerFeedbackMcpTools()`. The standalone `feedback-mcp` binary cannot inject
an adapter. Without one, `feedback_diagnostics` remains available while every
storage tool returns an MCP error describing the readiness blocker.

## Tools

### `feedback_diagnostics`

Takes no parameters. Returns redacted storage runtime diagnostics, including:

- requested mode and active store;
- local data file path in local mode;
- cloud provider and configuration-presence booleans in cloud mode; and
- readiness state and blockers.

Diagnostics never include configured database URLs, resource ARNs, secret ARNs,
table values, or token values.

### `submit_feedback`

Creates one feedback item with source `mcp`.

| Parameter | Required | Values |
| --- | --- | --- |
| `app_id` | yes | Stable application id or slug |
| `message` | yes | Feedback text |
| `kind` | no | `bug`, `idea`, `question`, `praise`, `other` |
| `severity` | no | `low`, `medium`, `high`, `critical` |
| `user_id` | no | User id |
| `email` | no | Valid email |
| `url` | no | Valid URL |
| `rating` | no | Integer from 1 to 5 |
| `tags` | no | String array |
| `metadata` | no | Object |
| `context` | no | Object |

The tool applies the same validation, normalization, and secret redaction as the
HTTP API before passing input to local or injected storage.

### `list_feedback`

Returns matching entries as formatted JSON, newest first.

| Parameter | Required | Values |
| --- | --- | --- |
| `app_id` | no | Exact app id |
| `status` | no | `new`, `triaged`, `shipped`, `closed` |
| `tag` | no | Exact normalized tag |
| `search` | no | Case-insensitive text search |
| `since` | no | JavaScript-parsable date |
| `until` | no | JavaScript-parsable date |
| `limit` | no | Integer from 1 to 500; storage defaults to 50 |

### `get_feedback`

Requires `id`. Returns one formatted JSON item or an MCP error when the id does
not exist.

### `update_feedback_status`

Requires `id` and `status`. Status must be `new`, `triaged`, `shipped`, or
`closed`. Returns the updated item or an MCP error when the id does not exist.

Setting status to `shipped` does not record changelog linkage. The MCP surface
does not currently expose `markFeedbackShipped()`.

### `feedback_stats`

Takes no parameters. Returns total counts and counts grouped by app, kind,
status, and severity.

### `export_feedback`

Accepts the same filter parameters as `list_feedback`, plus:

| Parameter | Required | Values |
| --- | --- | --- |
| `format` | no | `jsonl` or `json`; defaults to `jsonl` |

`json` returns a formatted JSON array. `jsonl` returns newline-delimited JSON
with a trailing newline when at least one item exists. Export storage defaults
to 500 items when `limit` is omitted.

## Programmatic Setup

```ts
import { createFeedbackMcpServer } from "@hasna/feedback/mcp";

const server = createFeedbackMcpServer({
  name: "my-feedback-server",
  version: "1.0.0",
  store,
});
```

For lower-level registration, `buildFeedbackMcpTools()` returns tool definitions
and `registerFeedbackMcpTools()` registers them on an existing `McpServer`.
