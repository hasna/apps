import { nanoid } from "nanoid";
import { getDb } from "./database.js";
import type {
  AppendKnowledgeSourceOutboxEventInput,
  KnowledgeSourceOutboxCheckpoint,
  KnowledgeSourceOutboxEvent,
  KnowledgeSourceOutboxEventType,
  KnowledgeSourceOutboxPollResult,
  KnowledgeSourceOutboxWatermark,
  ListKnowledgeSourceOutboxEventsOptions,
} from "../types/index.js";

interface OutboxEventRow {
  id: string;
  cursor: number;
  event_type: string;
  source_ref: string | null;
  file_id: string | null;
  source_id: string | null;
  revision_id: string | null;
  previous_revision_id: string | null;
  status: string | null;
  hash: string | null;
  size: number | null;
  mime: string | null;
  path: string | null;
  idempotency_key: string | null;
  metadata: string;
  created_at: string;
}

interface CheckpointRow {
  consumer_id: string;
  cursor: number;
  metadata: string;
  updated_at: string;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function toEvent(row: OutboxEventRow): KnowledgeSourceOutboxEvent {
  return {
    id: row.id,
    cursor: row.cursor,
    event_type: row.event_type as KnowledgeSourceOutboxEventType,
    source_ref: row.source_ref ?? undefined,
    file_id: row.file_id ?? undefined,
    source_id: row.source_id ?? undefined,
    revision_id: row.revision_id ?? undefined,
    previous_revision_id: row.previous_revision_id ?? undefined,
    status: row.status ?? undefined,
    hash: row.hash ?? undefined,
    size: row.size ?? undefined,
    mime: row.mime ?? undefined,
    path: row.path ?? undefined,
    idempotency_key: row.idempotency_key ?? undefined,
    metadata: parseJsonObject(row.metadata),
    created_at: row.created_at,
  };
}

function toCheckpoint(row: CheckpointRow): KnowledgeSourceOutboxCheckpoint {
  return {
    consumer_id: row.consumer_id,
    cursor: row.cursor,
    metadata: parseJsonObject(row.metadata),
    updated_at: row.updated_at,
  };
}

export function appendKnowledgeSourceOutboxEvent(input: AppendKnowledgeSourceOutboxEventInput): KnowledgeSourceOutboxEvent {
  const db = getDb();

  if (input.idempotency_key) {
    const existing = db.query<OutboxEventRow, [string]>(
      "SELECT * FROM knowledge_source_outbox_events WHERE idempotency_key = ?",
    ).get(input.idempotency_key);
    if (existing) return toEvent(existing);
  }

  const id = input.id ?? `out_${nanoid(14)}`;
  db.transaction(() => {
    const next = db.query<{ cursor: number }, []>(
      "SELECT COALESCE(MAX(cursor), 0) + 1 AS cursor FROM knowledge_source_outbox_events",
    ).get()!.cursor;
    db.run(
      `INSERT INTO knowledge_source_outbox_events (
        id, cursor, event_type, source_ref, file_id, source_id,
        revision_id, previous_revision_id, status, hash, size, mime, path,
        idempotency_key, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        next,
        input.event_type,
        input.source_ref ?? null,
        input.file_id ?? null,
        input.source_id ?? null,
        input.revision_id ?? null,
        input.previous_revision_id ?? null,
        input.status ?? null,
        input.hash ?? null,
        input.size ?? null,
        input.mime ?? null,
        input.path ?? null,
        input.idempotency_key ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.created_at ?? new Date().toISOString(),
      ],
    );
  });

  return getKnowledgeSourceOutboxEvent(id)!;
}

export function getKnowledgeSourceOutboxEvent(idOrCursor: string | number): KnowledgeSourceOutboxEvent | null {
  const row = typeof idOrCursor === "number"
    ? getDb().query<OutboxEventRow, [number]>(
        "SELECT * FROM knowledge_source_outbox_events WHERE cursor = ?",
      ).get(idOrCursor)
    : getDb().query<OutboxEventRow, [string]>(
        "SELECT * FROM knowledge_source_outbox_events WHERE id = ?",
      ).get(idOrCursor);
  return row ? toEvent(row) : null;
}

export function listKnowledgeSourceOutboxEvents(
  opts: ListKnowledgeSourceOutboxEventsOptions = {},
): KnowledgeSourceOutboxEvent[] {
  const checkpoint = opts.consumer_id && opts.after_cursor === undefined
    ? getKnowledgeSourceOutboxCheckpoint(opts.consumer_id)
    : null;
  const afterCursor = opts.after_cursor ?? checkpoint?.cursor ?? 0;
  const limit = normalizeLimit(opts.limit);
  const conditions: string[] = ["cursor > ?"];
  const params: unknown[] = [afterCursor];

  if (opts.event_types?.length) {
    conditions.push(`event_type IN (${opts.event_types.map(() => "?").join(",")})`);
    params.push(...opts.event_types);
  }
  if (opts.source_id) {
    conditions.push("source_id = ?");
    params.push(opts.source_id);
  }
  if (opts.file_id) {
    conditions.push("file_id = ?");
    params.push(opts.file_id);
  }

  return getDb()
    .query<OutboxEventRow, any[]>(
      `SELECT * FROM knowledge_source_outbox_events
       WHERE ${conditions.join(" AND ")}
       ORDER BY cursor ASC
       LIMIT ?`,
    )
    .all(...params, limit)
    .map(toEvent);
}

export function pollKnowledgeSourceOutbox(
  opts: ListKnowledgeSourceOutboxEventsOptions = {},
): KnowledgeSourceOutboxPollResult {
  const checkpoint = opts.consumer_id ? getKnowledgeSourceOutboxCheckpoint(opts.consumer_id) : null;
  const cursor = opts.after_cursor ?? checkpoint?.cursor ?? 0;
  const limit = normalizeLimit(opts.limit);
  const events = listKnowledgeSourceOutboxEvents({ ...opts, after_cursor: cursor, limit: limit + 1 });
  const visibleEvents = events.slice(0, limit);
  const nextCursor = visibleEvents.at(-1)?.cursor ?? cursor;
  return {
    events: visibleEvents,
    cursor,
    next_cursor: nextCursor,
    has_more: events.length > limit,
    checkpoint: checkpoint ?? undefined,
    watermark: getKnowledgeSourceOutboxWatermark(opts.consumer_id),
  };
}

export function acknowledgeKnowledgeSourceOutbox(
  consumerId: string,
  cursor: number,
  metadata: Record<string, unknown> = {},
): KnowledgeSourceOutboxCheckpoint {
  if (!consumerId) throw new Error("consumer_id is required.");
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error("cursor must be a non-negative integer.");
  getDb().run(
    `INSERT INTO knowledge_source_outbox_checkpoints (consumer_id, cursor, metadata, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(consumer_id) DO UPDATE SET
       cursor = CASE WHEN excluded.cursor > knowledge_source_outbox_checkpoints.cursor
         THEN excluded.cursor ELSE knowledge_source_outbox_checkpoints.cursor END,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at`,
    [consumerId, cursor, JSON.stringify(metadata), new Date().toISOString()],
  );
  return getKnowledgeSourceOutboxCheckpoint(consumerId)!;
}

export function getKnowledgeSourceOutboxCheckpoint(consumerId: string): KnowledgeSourceOutboxCheckpoint | null {
  const row = getDb().query<CheckpointRow, [string]>(
    "SELECT * FROM knowledge_source_outbox_checkpoints WHERE consumer_id = ?",
  ).get(consumerId);
  return row ? toCheckpoint(row) : null;
}

export function getKnowledgeSourceOutboxWatermark(consumerId?: string): KnowledgeSourceOutboxWatermark {
  const latest = getDb().query<{ latest_cursor: number }, []>(
    "SELECT COALESCE(MAX(cursor), 0) AS latest_cursor FROM knowledge_source_outbox_events",
  ).get()?.latest_cursor ?? 0;
  if (!consumerId) return { latest_cursor: latest };
  const checkpoint = getKnowledgeSourceOutboxCheckpoint(consumerId);
  return {
    latest_cursor: latest,
    consumer_id: consumerId,
    checkpoint_cursor: checkpoint?.cursor ?? 0,
    lag: Math.max(0, latest - (checkpoint?.cursor ?? 0)),
    updated_at: checkpoint?.updated_at,
  };
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value ?? DEFAULT_LIMIT)) return DEFAULT_LIMIT;
  const normalized = Math.floor(value ?? DEFAULT_LIMIT);
  if (normalized <= 0) return DEFAULT_LIMIT;
  return Math.min(normalized, MAX_LIMIT);
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
