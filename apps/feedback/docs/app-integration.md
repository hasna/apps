# App Integration

Open Feedback is designed for Hasna-coded apps that need a consistent way to capture user reports, product ideas, and agent-generated feedback.

## Recommended App Fields

Send at least:

- `appId`: stable app slug, such as `open-projects` or `platform-mailery`
- `message`: user-visible feedback text
- `kind`: `bug`, `idea`, `question`, `praise`, or `other`
- `context.route`: the current app route or screen
- `context.version`: app version or deployed build id
- `context.environment`: `local`, `staging`, or `production`

Optional fields include `userId`, `email`, `url`, `rating`, `severity`, `tags`, and `metadata`.

## Browser Apps

```ts
import { createFeedbackClient } from "@hasna/feedback";

const feedback = createFeedbackClient({
  baseUrl: import.meta.env.VITE_FEEDBACK_API_URL,
  token: import.meta.env.VITE_FEEDBACK_TOKEN,
});

export async function sendFeedback(message: string) {
  return feedback.submit({
    appId: "my-browser-app",
    message,
    kind: "other",
    context: {
      route: window.location.pathname,
      url: window.location.href,
      userAgent: navigator.userAgent,
      locale: navigator.language,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    },
  });
}
```

For public browser clients, prefer a short-lived app backend endpoint that adds the Open Feedback API token server-side.

## Server Apps

```ts
import { LocalFeedbackStore } from "@hasna/feedback/storage";

const store = new LocalFeedbackStore({
  dataDir: process.env.FEEDBACK_DATA_DIR,
});

await store.createFeedback({
  appId: "my-server-app",
  message: "Background import failed",
  kind: "bug",
  severity: "high",
  metadata: {
    jobId: "job_123",
  },
});
```

## API Deployment

```bash
FEEDBACK_DATA_DIR=/var/lib/open-feedback \
FEEDBACK_API_TOKEN="$FEEDBACK_API_TOKEN" \
feedback serve --host 0.0.0.0 --port 8787
```

When `FEEDBACK_API_TOKEN` is set, clients must send:

```http
Authorization: Bearer <token>
```

## CLI Collection

```bash
feedback submit "Search results need date filters" --app my-app --kind idea --tag search
feedback list --app my-app
feedback export --format jsonl > feedback.jsonl
```

## MCP Collection

Agents can run `feedback-mcp` and call `submit_feedback` with the same shape as the HTTP API. This gives coding agents a standard place to file product feedback discovered during implementation or verification.

## Data Handling

Open Feedback stores newline-delimited JSON in `~/.hasna/feedback/feedback.jsonl` by default. The JSONL format is intentionally portable: teams can archive it, load it into a database later, or pipe it into analysis workflows.

