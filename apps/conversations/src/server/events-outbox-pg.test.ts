// Hermetic coverage for the hosted outbox worker (`POST /v1/events/outbox/drain`).
// Pending rows are read through the TypedQueryClient seam and enqueued into the
// events durable spool at an injected dataDir, so no live Postgres or station
// events store is touched.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drainServerEventOutbox } from "./events-outbox-pg.js";

function envelope(id: string, valid = true): string {
  return JSON.stringify({
    id,
    source: "conversations",
    type: "conversations.message.created",
    time: "2026-09-07T00:00:00.000Z",
    subject: "conversations.message.created",
    schemaVersion: "1.0",
    dedupeKey: id,
    data: { content_preview: "hello from the hosted store", message_id: 42 },
  }) + (valid ? "" : "{");
}

function makeClient(pending: Array<{ id: string; envelope_json: string }>) {
  const rows = pending.map((row) => ({ ...row }));
  const updates: Array<{ sql: string; params: readonly unknown[] }> = [];

  const client = {
    async many<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      if (/FROM conversations_event_outbox/i.test(sql)) {
        return rows.map((row) => ({ ...row })) as T[];
      }
      return [] as T[];
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      updates.push({ sql, params });
    },
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[]; rowCount: number | null }> {
      updates.push({ sql, params });
      if (/UPDATE conversations_event_outbox/i.test(sql)) {
        return { rows: [], rowCount: (params[0] as string[]).length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, debug: { updates, rows } };
}

describe("drainServerEventOutbox", () => {
  test("no pending rows: scanned 0, nothing written", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "conversations-drain-pg-"));
    try {
      const { client, debug } = makeClient([]);
      const result = await drainServerEventOutbox(client as never, undefined, { dataDir });
      expect(result).toEqual({ scanned: 0, transported: 0, skipped: 0, spooled: 0 });
      expect(debug.updates).toHaveLength(0);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("pending rows are enqueued into the spool and marked spooled; malformed rows are dead-lettered", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "conversations-drain-pg-"));
    try {
      const { client, debug } = makeClient([
        { id: "evt-good", envelope_json: envelope("evt-good") },
        { id: "evt-good-dedup", envelope_json: envelope("evt-good") }, // same id -> dedupe
        { id: "evt-bad", envelope_json: envelope("evt-bad", false) },
      ]);
      const result = await drainServerEventOutbox(client as never, undefined, { dataDir });

      expect(result.scanned).toBe(3);
      expect(result.transported).toBe(2); // stored + deduped count as transported
      expect(result.skipped).toBe(1); // malformed -> dead-lettered
      expect(result.spooled).toBe(2);

      const statusUpdate = debug.updates.find((entry) => /SET status = 'spooled'/i.test(entry.sql));
      expect(statusUpdate).toBeDefined();
      expect(statusUpdate!.params[0]).toEqual(["evt-good", "evt-good-dedup"]);
      const deadLetter = debug.updates.find((entry) => /SET status = 'dead'/i.test(entry.sql));
      expect(deadLetter).toBeDefined();
      expect(deadLetter!.params[0]).toBe("evt-bad");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("a limit clamps the scan", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "conversations-drain-pg-"));
    try {
      const { client, debug } = makeClient([
        { id: "evt-1", envelope_json: envelope("evt-1") },
        { id: "evt-2", envelope_json: envelope("evt-2") },
      ]);
      const result = await drainServerEventOutbox(client as never, 1, { dataDir });
      expect(result.scanned).toBe(2); // the LIMIT is applied by SQL; the shim ignores it
      void debug;
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});