// Hosted outbox worker: `POST /v1/events/outbox/drain`.
//
// Mirrors the local outbox worker (`drainConversationEventOutbox` in
// src/lib/events-bridge.ts) on the server's own store: pending rows in the
// server's `conversations_event_outbox` table are transported into the Events
// durable spool inbox on the server box, then marked `spooled`; malformed
// envelopes are dead-lettered. The CLI's `events-drain` command reaches this
// through ApiStore when the hosted API resolves — one command, one semantics,
// on whichever store the resolver selected.
import { getEventsDataDir } from "@hasna/events";
import { DurableEventSpool } from "@hasna/events/durable-spool";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";

export interface DrainEventOutboxResult {
  scanned: number;
  transported: number;
  skipped: number;
  spooled: number;
}

export async function drainServerEventOutbox(
  client: TypedQueryClient,
  limit?: number,
  options: { dataDir?: string } = {},
): Promise<DrainEventOutboxResult> {
  const maxRows = limit !== undefined && limit > 0 ? Math.max(1, Math.floor(limit)) : 100;
  const rows = await client.many<{ id: string; envelope_json: string }>(
    `SELECT id, envelope_json FROM conversations_event_outbox
     WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1`,
    [maxRows],
  );
  const result: DrainEventOutboxResult = { scanned: rows.length, transported: 0, skipped: 0, spooled: 0 };
  if (rows.length === 0) return result;

  const spool = new DurableEventSpool({ dataDir: options.dataDir ?? getEventsDataDir() });
  const transportedIds: string[] = [];
  try {
    for (const row of rows) {
      let event: unknown;
      try {
        event = JSON.parse(row.envelope_json);
      } catch {
        // Malformed envelope: dead-letter instead of re-scanning it forever.
        await client.execute("UPDATE conversations_event_outbox SET status = 'dead' WHERE id = $1", [row.id]);
        result.skipped += 1;
        continue;
      }
      const enqueued = await spool.enqueue(event as Parameters<DurableEventSpool["enqueue"]>[0]);
      if (enqueued.stored || enqueued.deduped) {
        transportedIds.push(row.id);
        result.transported += 1;
      } else {
        result.skipped += 1;
      }
    }
  } finally {
    await spool.close();
  }

  if (transportedIds.length > 0) {
    const updated = await client.query(
      `UPDATE conversations_event_outbox
       SET status = 'spooled', attempts = attempts + 1
       WHERE id = ANY($1::text[])`,
      [transportedIds],
    );
    result.spooled = updated.rowCount ?? transportedIds.length;
  }
  return result;
}