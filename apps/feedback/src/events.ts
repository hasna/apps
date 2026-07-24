import { EventsClient, createEvent } from "@hasna/events";
import type { EventEnvelope } from "@hasna/events";
import type { FeedbackItem } from "./types.js";

// ---------------------------------------------------------------------------
// Vendored mirror of the distribution event catalog constants from
// `@hasna/events` branch feat/distribution-event-catalog (the `./catalog`
// export is not published yet). Keep the type strings in sync with
// DISTRIBUTION_EVENT_TYPES / DISTRIBUTION_EVENT_CONTRACT_SCHEMAS.
// ---------------------------------------------------------------------------

export const FEEDBACK_EVENT_TYPES = {
  feedbackCreated: "feedback.created",
  feedbackTriaged: "feedback.triaged",
} as const;

export type FeedbackEventType = (typeof FEEDBACK_EVENT_TYPES)[keyof typeof FEEDBACK_EVENT_TYPES];

/** Contracts schema id the feedback event payloads mirror (owned by a later lane). */
export const FEEDBACK_EVENT_CONTRACT_SCHEMA = "hasna.feedback.v1" as const;

export const FEEDBACK_EVENT_SOURCE = "hasna.feedback" as const;

/** Mirror of `FeedbackCreatedData` from the distribution event catalog (open extra keys allowed). */
export interface FeedbackCreatedData extends Record<string, unknown> {
  feedbackId: string;
  appId?: string;
  source?: string;
  summary?: string;
  severity?: string;
}

/** Mirror of `FeedbackTriagedData` from the distribution event catalog (open extra keys allowed). */
export interface FeedbackTriagedData extends Record<string, unknown> {
  feedbackId: string;
  disposition: string;
  appId?: string;
  triagedBy?: string;
}

export type FeedbackEventEnvelope = EventEnvelope<FeedbackCreatedData> | EventEnvelope<FeedbackTriagedData>;

/**
 * Sink invoked with every feedback event envelope. The default sink appends
 * and delivers through `@hasna/events` (respects `HASNA_EVENTS_DIR`).
 */
export type FeedbackEventSink = (event: FeedbackEventEnvelope) => void | Promise<void>;

function summarize(message: string): string {
  const line = message.split("\n", 1)[0] ?? "";
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

export function buildFeedbackCreatedEvent(item: FeedbackItem): EventEnvelope<FeedbackCreatedData> {
  return createEvent<FeedbackCreatedData>({
    source: FEEDBACK_EVENT_SOURCE,
    type: FEEDBACK_EVENT_TYPES.feedbackCreated,
    time: item.createdAt,
    subject: item.id,
    data: {
      feedbackId: item.id,
      appId: item.appId,
      source: item.source,
      summary: summarize(item.message),
      severity: item.severity,
      kind: item.kind,
    },
    metadata: { contractSchema: FEEDBACK_EVENT_CONTRACT_SCHEMA },
    dedupeKey: `${FEEDBACK_EVENT_TYPES.feedbackCreated}:${item.id}`,
  });
}

export function buildFeedbackTriagedEvent(
  item: FeedbackItem,
  disposition: string,
  options: { triagedBy?: string } = {},
): EventEnvelope<FeedbackTriagedData> {
  return createEvent<FeedbackTriagedData>({
    source: FEEDBACK_EVENT_SOURCE,
    type: FEEDBACK_EVENT_TYPES.feedbackTriaged,
    time: item.updatedAt,
    subject: item.id,
    data: {
      feedbackId: item.id,
      disposition,
      appId: item.appId,
      triagedBy: options.triagedBy,
      ...(item.changelogRef ? { changelogRef: item.changelogRef } : {}),
    },
    metadata: { contractSchema: FEEDBACK_EVENT_CONTRACT_SCHEMA },
    dedupeKey: `${FEEDBACK_EVENT_TYPES.feedbackTriaged}:${item.id}:${disposition}`,
  });
}

/** Default sink: emit through `@hasna/events` (JSON store + configured channels). */
export function createDefaultFeedbackEventSink(dataDir?: string): FeedbackEventSink {
  return async (event) => {
    const client = new EventsClient({ dataDir });
    await client.emit(event);
  };
}

/**
 * Emit an event through a sink without ever letting emission failures break
 * the feedback create/triage path.
 */
export async function emitFeedbackEvent(event: FeedbackEventEnvelope, sink: FeedbackEventSink): Promise<void> {
  try {
    await sink(event);
  } catch {
    // Event emission is best effort.
  }
}
