# Distribution Events

`LocalFeedbackStore` emits distribution event envelopes through `@hasna/events`
after feedback is created or updated to a non-`new` status. The event source is
`hasna.feedback` and payloads mirror contract schema `hasna.feedback.v1`.

Event delivery is best effort. Sink failures are swallowed and never fail the
feedback create or status-update operation.

## Configure Delivery

The default sink constructs an `EventsClient` for each event and honors
`HASNA_EVENTS_DIR`.

```ts
import { LocalFeedbackStore } from "@hasna/feedback/storage";

const withoutEvents = new LocalFeedbackStore({ eventSink: null });

const withCustomSink = new LocalFeedbackStore({
  eventSink: async (event) => {
    await publishEvent(event);
  },
});
```

Pass `eventSink: null` to disable events. Pass a `FeedbackEventSink` to receive
each envelope with custom delivery behavior.

## `feedback.created`

Emitted after `createFeedback()` persists an item.

```json
{
  "source": "hasna.feedback",
  "type": "feedback.created",
  "subject": "<feedback id>",
  "data": {
    "feedbackId": "<feedback id>",
    "appId": "my-app",
    "source": "api",
    "summary": "Feedback message first line",
    "severity": "high",
    "kind": "bug"
  },
  "metadata": {
    "contractSchema": "hasna.feedback.v1"
  },
  "dedupeKey": "feedback.created:<feedback id>"
}
```

The event time equals the feedback `createdAt` timestamp. `summary` uses only
the first message line and truncates values longer than 140 characters to 139
characters plus an ellipsis.

## `feedback.triaged`

Emitted after `updateFeedbackStatus()` sets an item to `triaged`, `shipped`, or
`closed`. Updating an item to `new` does not emit it. `markFeedbackShipped()`
also emits this event with disposition `shipped`.

```json
{
  "source": "hasna.feedback",
  "type": "feedback.triaged",
  "subject": "<feedback id>",
  "data": {
    "feedbackId": "<feedback id>",
    "disposition": "shipped",
    "appId": "my-app",
    "changelogRef": "my-app@1.2.3"
  },
  "metadata": {
    "contractSchema": "hasna.feedback.v1"
  },
  "dedupeKey": "feedback.triaged:<feedback id>:shipped"
}
```

The event time equals the updated feedback `updatedAt` timestamp.
`changelogRef` is present only when the item already has changelog linkage.
Programmatic callers can pass `triagedBy` to `buildFeedbackTriagedEvent()`; store
status methods do not currently populate it.

## Event Helpers

The root package and `@hasna/feedback/events` export:

- `FEEDBACK_EVENT_TYPES`, `FEEDBACK_EVENT_SOURCE`, and
  `FEEDBACK_EVENT_CONTRACT_SCHEMA`;
- `buildFeedbackCreatedEvent()` and `buildFeedbackTriagedEvent()`;
- `createDefaultFeedbackEventSink()` and `emitFeedbackEvent()`; and
- the event envelope, payload, sink, and event-type TypeScript types.
