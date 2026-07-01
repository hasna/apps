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

## Feedback Button and Popover

Apps should expose feedback from the active workflow, usually as a small button in the app toolbar, account menu, or page footer. Keep the popover focused on the report itself and collect enough context automatically so users do not need to describe where they are.

```tsx
import { useState } from "react";
import { createFeedbackClient } from "@hasna/feedback";

const feedback = createFeedbackClient({
  baseUrl: "/api/feedback",
});

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  async function submitFeedback() {
    await feedback.submit({
      appId: "my-browser-app",
      message,
      kind: "other",
      context: {
        route: window.location.pathname,
        url: window.location.href,
        userAgent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      },
    });
    setMessage("");
    setOpen(false);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Feedback</button>
      {open ? (
        <form
          role="dialog"
          aria-label="Send feedback"
          onSubmit={(event) => {
            event.preventDefault();
            void submitFeedback();
          }}
        >
          <textarea value={message} onChange={(event) => setMessage(event.currentTarget.value)} />
          <button type="submit">Send</button>
        </form>
      ) : null}
    </>
  );
}
```

If the deployed API uses `FEEDBACK_API_TOKEN`, route browser submissions through your app backend and add the token server-side instead of shipping it to the browser.

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

Terminal slash-command wrappers can delegate directly to the same CLI:

```bash
# /feedback Search results need date filters
feedback submit "Search results need date filters" --app my-app --kind idea --tag slash-command

# /bug Billing export fails on custom ranges
feedback submit "Billing export fails on custom ranges" --app my-app --kind bug --severity high
```

## MCP Collection

Agents can run `feedback-mcp` and call `submit_feedback` with the same shape as the HTTP API. This gives coding agents a standard place to file product feedback discovered during implementation or verification.

## Data Handling

Open Feedback stores newline-delimited JSON in `~/.hasna/feedback/feedback.jsonl` by default. The JSONL format is intentionally portable: teams can archive it, load it into a database later, or pipe it into analysis workflows.
