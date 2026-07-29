# HTTP API Reference

Start the API with either binary:

```bash
feedback serve --host 127.0.0.1 --port 8787
feedback-serve --host 127.0.0.1 --port 8787
```

Applications can also mount `createFeedbackHandler()` in an existing Bun
server or call `startFeedbackServer()` from `@hasna/feedback/server`.

## Authentication

`GET /health` and all `OPTIONS` preflight requests are public. Feedback routes
use one of four scopes:

| Scope | Environment variable | Routes |
| --- | --- | --- |
| submit | `FEEDBACK_SUBMIT_TOKEN` | `POST /v1/feedback` |
| read | `FEEDBACK_READ_TOKEN` | list, get one, and stats |
| triage | `FEEDBACK_TRIAGE_TOKEN` | status update |
| export | `FEEDBACK_EXPORT_TOKEN` | JSONL export |

`FEEDBACK_API_TOKEN` is the legacy fallback for every scope that does not have
a scoped token. Tokens can also be passed with the `tokens` or `apiToken`
handler options.

Clients may use either header:

```http
Authorization: Bearer <token>
X-Feedback-Token: <token>
```

Set `FEEDBACK_PUBLIC_SUBMIT=1` or pass `publicSubmit: true` to bypass submit
authentication. This does not make read, triage, or export public.

Shared deployment mode is enabled explicitly with `sharedDeployment: true`, by
setting `FEEDBACK_DEPLOYMENT_MODE` to a non-`local` value, or implicitly when a
legacy token is configured or the read, triage, or export token environment
variable is present. Programmatic scoped tokens alone do not select shared mode;
pass `sharedDeployment: true` with them. In shared mode, a route without its
required scoped or fallback token returns `503` instead of becoming public. A
wrong or missing configured credential returns `401`.

## Feedback Input

`POST /v1/feedback` accepts JSON with these fields:

| Field | Type | Rules |
| --- | --- | --- |
| `appId` | string | Required; trimmed; 1-128 characters |
| `message` | string | Required; trimmed; 1-10,000 characters; API spam checks require at least 3 |
| `kind` | string | `bug`, `idea`, `question`, `praise`, or `other`; defaults to `other` |
| `severity` | string | `low`, `medium`, `high`, or `critical` |
| `userId` | string | At most 256 characters |
| `email` | string | Valid email; at most 320 characters |
| `url` | string | Valid URL; at most 2,048 characters |
| `rating` | integer | 1-5 |
| `tags` | string[] | At most 25; each 1-64 characters after trimming |
| `metadata` | object | JSON values only |
| `context` | object | JSON values only |

Tags are lowercased, deduplicated, and sorted. Common credential patterns are
redacted from text and URLs, and values under sensitive metadata or context
keys are replaced with `[redacted]` before the store receives the input.

Created items add `id`, `createdAt`, `updatedAt`, `status: "new"`,
`source: "api"`, defaulted `kind`, and normalized `tags`.

## Routes

### Health

```http
GET /health
```

Returns the service name, package version, and readiness flag:

```json
{
  "ok": true,
  "service": "open-feedback",
  "version": "0.2.0"
}
```

The version follows the installed package and may differ from this example.

### Submit

```http
POST /v1/feedback
Content-Type: application/json
```

Returns the created item with status `201`. Before storage, the handler rejects
messages shorter than 3 characters, messages with more than three HTTP links,
messages containing a character repeated more than 40 times, duplicate recent
submissions, and requests over the per-client rate limit.

### List

```http
GET /v1/feedback?appId=my-app&status=new&tag=billing&search=invoice&limit=50
```

Returns a newest-first JSON array. Supported query parameters:

| Parameter | Behavior |
| --- | --- |
| `appId` | Exact app id |
| `status` | `new`, `triaged`, `shipped`, or `closed` |
| `tag` | Exact normalized tag, compared case-insensitively |
| `search` | Case-insensitive search across core fields, tags, context, and metadata |
| `since` | Created at or after a JavaScript-parsable date |
| `until` | Created at or before a JavaScript-parsable date |
| `limit` | Positive integer; defaults to 50 and caps at 500 |

Invalid date values are ignored. An invalid status returns `400`; an invalid
limit uses the default.

### Get One

```http
GET /v1/feedback/:id
```

Returns one item or `404` when it does not exist.

### Update Status

```http
PATCH /v1/feedback/:id
Content-Type: application/json

{ "status": "triaged" }
```

The status must be `new`, `triaged`, `shipped`, or `closed`. The route returns
the updated item, `404` for an unknown id, or `400` for an invalid status.

This endpoint does not accept a changelog reference and does not set
`changelogRef` or `shippedAt` when status becomes `shipped`.

### Stats

```http
GET /v1/stats
```

Returns total counts and counts grouped by app, kind, status, and severity.

### Export

```http
GET /v1/export.jsonl?appId=my-app&until=2026-12-31&limit=500
```

Accepts the same filters as list. It defaults to 500 items and returns
newline-delimited JSON as `text/plain; charset=utf-8`. A non-empty export ends
with a newline.

## Rate Limit and Duplicates

The default submit limit is 20 requests per client in a 60-second window. Pass
`rateLimit.windowMs` or `rateLimit.maxSubmissions` to override it. Client identity
uses the first `X-Forwarded-For` address, then `CF-Connecting-IP`, then the
literal key `local`.

Duplicate suppression uses normalized app id, message, user id, and email over
the same window and applies across client addresses. A rate-limit rejection is
`429`; a duplicate is `409`; spam validation is `400`. These checks are
in-memory per handler instance and reset when the process restarts.

## CORS and Errors

Responses include:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,PATCH,OPTIONS
Access-Control-Allow-Headers: authorization,content-type,x-feedback-token
```

Set `FEEDBACK_CORS_ORIGIN` or pass `corsOrigin` to replace `*`. Every `OPTIONS`
request returns `204`.

JSON errors use `{ "error": "..." }`. Validation and request parsing errors are
reported as `400`; unknown routes return `404`.

## Programmatic Configuration

```ts
import { createFeedbackHandler } from "@hasna/feedback";

const handler = createFeedbackHandler({
  store,
  tokens: {
    submit: process.env.FEEDBACK_SUBMIT_TOKEN,
    read: process.env.FEEDBACK_READ_TOKEN,
    triage: process.env.FEEDBACK_TRIAGE_TOKEN,
    export: process.env.FEEDBACK_EXPORT_TOKEN,
  },
  publicSubmit: false,
  sharedDeployment: true,
  corsOrigin: "https://app.example.com",
  rateLimit: {
    windowMs: 60_000,
    maxSubmissions: 20,
  },
});
```

When `store` is omitted, the handler constructs the selected storage runtime.
Cloud mode therefore requires the host to pass an injected `FeedbackStore`.
