/**
 * Conversations → Events bridge (webhook-delivery contract).
 *
 * Emission is a two-stage capture-and-transport contract: the message/task
 * mutation writes a `conversations_event_outbox` row in the SAME transaction
 * (`emitConversationEvent`), and a separate outbox worker transports pending
 * rows into the Events durable substrate (`drainConversationEventOutbox`,
 * local: the events spool inbox; hosted: signed webhook POST to the events
 * ingress).
 */

import { createEvent, getEventsDataDir, type EventEnvelope, type EventInput } from "@hasna/events";
import { DurableEventSpool } from "@hasna/events/durable-spool";
import {
  ensureEventsOutboxSchema,
  insertEventOutboxRow,
  listPendingEventOutbox,
  markEventOutboxDead,
  markEventOutboxSpooled,
  type EventOutboxDatabase,
} from "./events-outbox.js";

export const CONVERSATIONS_SOURCE = "conversations";
export const MESSAGE_CREATED_TYPE = "conversations.message.created";
export const TASK_CREATED_TYPE = "conversations.task.created";
export const TASK_UPDATED_TYPE = "conversations.task.updated";
export const EVENT_SCHEMA_VERSION = "1.0";
export const CONTENT_PREVIEW_CHARS = 512;

export interface ConversationEventData {
  [key: string]: unknown;
}

export interface ConversationEventInput {
  /** Stable source-persisted event identity (id === dedupeKey for these events). */
  id: string;
  type: string;
  /** ISO8601 UTC time of the mutation commit. */
  time: string;
  subject?: string;
  data: ConversationEventData;
  message?: string;
  appEvent?: Record<string, unknown>;
}

/** Builds the subscriber-visible EventEnvelope verbatim (contract section 2). */
export function buildConversationEventEnvelope(input: ConversationEventInput): EventEnvelope {
  return createEvent({
    id: input.id,
    source: CONVERSATIONS_SOURCE,
    type: input.type,
    time: input.time,
    subject: input.subject,
    data: input.data,
    message: input.message,
    dedupeKey: input.id,
    schemaVersion: EVENT_SCHEMA_VERSION,
    metadata: input.appEvent ? { app_event: input.appEvent } : {},
  });
}

/**
 * Persists exactly one outbox row for a committed mutation. MUST be called
 * inside the caller's transaction so a commit can never lack durable event
 * intent. Idempotent by stable event id: a replay does not mint a second row.
 */
export function emitConversationEvent(db: EventOutboxDatabase, input: ConversationEventInput): boolean {
  const envelope = buildConversationEventEnvelope(input);
  return insertEventOutboxRow(db, {
    id: envelope.id,
    source: CONVERSATIONS_SOURCE,
    type: envelope.type,
    envelope_json: JSON.stringify(envelope),
    created_at: envelope.time,
    status: "pending",
    attempts: 0,
  });
}

export interface DrainEventOutboxOptions {
  dataDir?: string;
  limit?: number;
  spool?: DurableEventSpool;
}

export interface DrainEventOutboxResult {
  scanned: number;
  transported: number;
  skipped: number;
  spooled: number;
}

/**
 * Outbox worker (local path): transports pending outbox rows into the Events
 * durable spool inbox on this machine. The worker is called by the operator
 * (e.g. `conversations events-drain`); a hosted deployment transports via a
 * signed webhook instead and does not use this local function.
 */
export async function drainConversationEventOutbox(
  db: EventOutboxDatabase,
  options: DrainEventOutboxOptions = {},
): Promise<DrainEventOutboxResult> {
  ensureEventsOutboxSchema(db);
  const limit = Math.max(1, options.limit ?? 100);
  const spool = options.spool ?? new DurableEventSpool({ dataDir: options.dataDir ?? getEventsDataDir() });
  const pending = listPendingEventOutbox(db, limit);
  const result: DrainEventOutboxResult = { scanned: pending.length, transported: 0, skipped: 0, spooled: 0 };
  const transportedIds: string[] = [];
  for (const row of pending) {
    let event: EventInput<ConversationEventData>;
    try {
      event = JSON.parse(row.envelope_json) as EventInput<ConversationEventData>;
    } catch {
      // Malformed envelope: dead-letter instead of leaving it 'pending' forever
      // (re-scanned and re-failed on every drain).
      markEventOutboxDead(db, row.id);
      result.skipped += 1;
      continue;
    }
    const enqueued = await spool.enqueue(event);
    if (enqueued.stored || enqueued.deduped) {
      transportedIds.push(row.id);
      result.transported += 1;
    } else {
      result.skipped += 1;
    }
  }
  result.spooled = markEventOutboxSpooled(db, transportedIds);
  return result;
}
