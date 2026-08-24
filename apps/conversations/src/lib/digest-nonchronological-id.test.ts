import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { sendMessage, readDigest, getMessageById, type DigestResult } from "./messages";
import { createChannel } from "./channels";
import { closeDb, getDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-test-digest-nonchrono-${Date.now()}.db`);

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
  createChannel("incidents", "fixture");
  createChannel("incidents-clean", "fixture");
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  restoreStoreEnv();
});

/**
 * Insert a message and then rewrite its created_at to an arbitrary timestamp.
 * This is how the fleet's incidents channel actually became non-chronological:
 * a message is BACKFILLED/imported later, so it receives a HIGHER autoincrement
 * id than its timestamp would suggest (measured 2026-08-24: id 730236 dated
 * 2026-08-21T10:55Z while id 722262 dated 2026-08-21T19:20Z).
 */
function backfill(channel: string, content: string, createdAt: string): { id: number; created_at: string } {
  const sent = sendMessage({ from: content, to: channel, channel, content });
  const db = getDb();
  db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(createdAt, sent.id);
  return { id: sent.id, created_at: createdAt };
}

/**
 * Page a digest the way a timestamp-watermark monitor does: follow `next_cursor`
 * AND advance the `since` watermark to the newest created_at seen so far. This is
 * the exact pattern that breaks when the cursor is id-ordered but ids are not
 * chronological with timestamps — the id walk hands back a message with a newer
 * timestamp first, the watermark jumps past messages whose ids are higher but
 * whose timestamps fall in between, and the walk reports has_more:false while
 * newer-timestamp messages remain unreached.
 */
function walkWithAdvancingSince(channel: string, windowStart: string, maxBytes = 65536): DigestResult[] {
  const pages: DigestResult[] = [];
  let since = windowStart;
  let cursor: number | undefined;
  for (let guard = 0; guard < 200; guard++) {
    const page = readDigest({ channel, since, cursor, max_bytes: maxBytes, limit: 1 });
    pages.push(page);
    const newest = page.messages.reduce((acc, m) => (m.created_at > acc ? m.created_at : acc), since);
    since = newest;
    if (!page.has_more || page.next_cursor === null || page.next_cursor === cursor) break;
    cursor = page.next_cursor;
  }
  return pages;
}

describe("digest cursor paging with non-chronological ids", () => {
  test("a window walk reaches every newer-timestamp message when ids are not chronological", () => {
    // Fixture reproduces the measured incidents shape: a HIGHER id carries an
    // EARLIER created_at, so the id sequence and the time sequence disagree.
    const windowStart = "2026-08-21T00:00:00.000Z";
    const seeded = [
      backfill("incidents", "A", "2026-08-21T19:20:00.000Z"), // lower id, newer
      backfill("incidents", "B", "2026-08-21T10:55:00.000Z"), // higher id, OLDER timestamp (backfilled)
      backfill("incidents", "C", "2026-08-22T08:00:00.000Z"), // highest id, newest timestamp
      backfill("incidents", "D", "2026-08-21T20:00:00.000Z"), // higher id than A, timestamp between A and C
    ];

    // POSITIVE CONTROL: every seeded message provably exists via an oracle that
    // is independent of every paging verb.
    for (const m of seeded) {
      expect(getMessageById(m.id)?.id).toBe(m.id);
    }

    const pages = walkWithAdvancingSince("incidents", windowStart);
    const delivered = pages.flatMap((p) => p.message_ids);

    // The walk must terminate, and it must not stop early while messages remain.
    expect(pages[pages.length - 1].has_more).toBe(false);
    expect(new Set(delivered).size).toBe(delivered.length); // no duplicates
    expect(delivered.slice().sort((a, b) => a - b)).toEqual(seeded.map((m) => m.id).sort((a, b) => a - b));
  });

  test("a walk with chronological ids is the negative control: it still terminates cleanly", () => {
    const windowStart = "2026-08-21T00:00:00.000Z";
    const seeded = [
      backfill("incidents-clean", "A", "2026-08-21T10:55:00.000Z"),
      backfill("incidents-clean", "B", "2026-08-21T19:20:00.000Z"),
      backfill("incidents-clean", "C", "2026-08-21T20:00:00.000Z"),
      backfill("incidents-clean", "D", "2026-08-22T08:00:00.000Z"),
    ];

    const pages = walkWithAdvancingSince("incidents-clean", windowStart);
    const delivered = pages.flatMap((p) => p.message_ids);

    expect(pages[pages.length - 1].has_more).toBe(false);
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(delivered.slice().sort((a, b) => a - b)).toEqual(seeded.map((m) => m.id).sort((a, b) => a - b));
  });
});
