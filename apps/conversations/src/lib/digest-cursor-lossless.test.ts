import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { sendMessage, readDigest, getMessageById, type DigestResult } from "./messages";
import { createChannel } from "./channels";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-digest-cursor-${Date.now()}.db`);

const FIXTURE_CHANNELS = [
  "cursor-complete",
  "cursor-accounting",
  "cursor-mid",
  "cursor-past",
  "defer",
  "semantics",
];

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
  for (const name of FIXTURE_CHANNELS) createChannel(name, "fixture");
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

/**
 * Seed a channel with a mix of short and long messages purely so that some pages
 * are byte-truncated — truncation is the surface under test and a uniform
 * fixture would not produce it.
 *
 * The mix is a way of constructing page boundaries and nothing more. It is NOT
 * evidence about which messages the old code lost: the victim was whichever
 * message landed where the remaining budget ran out, which is a function of
 * packing position rather than of message size.
 */
function seedMixedChannel(channel: string, count: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const long = i % 3 === 0;
    const content = long ? `long-${i} ${"y".repeat(600)}` : `short-${i}`;
    ids.push(sendMessage({ from: `agent-${i % 4}`, to: channel, channel, content }).id);
  }
  return ids;
}

/** Page a digest the way the envelope tells you to: follow `next_cursor`. */
function pageFollowingNextCursor(channel: string, maxBytes: number): DigestResult[] {
  const pages: DigestResult[] = [];
  let cursor: number | undefined;
  for (let guard = 0; guard < 500; guard++) {
    const page = readDigest({ channel, max_bytes: maxBytes, cursor });
    pages.push(page);
    if (!page.has_more) break;
    const next = page.next_cursor ?? undefined;
    // A cursor that does not advance would spin forever; stop and let the
    // assertions describe what happened rather than hanging the suite.
    if (next === undefined || next === cursor) break;
    cursor = next;
  }
  return pages;
}

describe("digest cursor contract", () => {
  test("paging on next_cursor delivers every message exactly once", () => {
    const seeded = seedMixedChannel("cursor-complete", 40);

    // POSITIVE CONTROL, and it is the point of the test's shape.
    //
    // Establish that every seeded message exists by a path that is INDEPENDENT
    // of any list or paging verb — `getMessageById` is the unit-test analogue of
    // `conversations show <id> --json`. Comparing one reader against another
    // reader is not ground truth: it invites "maybe the other reader
    // over-reports", and a converged count is still not a complete one. An
    // existence oracle admits no such escape, and it means a future failure
    // reads as "the paginator dropped an id that provably exists" rather than
    // "the fixture is broken".
    for (const id of seeded) {
      expect(getMessageById(id)?.id).toBe(id);
    }

    const pages = pageFollowingNextCursor("cursor-complete", 1400);
    const delivered = pages.flatMap((p) => p.message_ids);

    // The fixture must actually overflow the cap partway through a page, or the
    // failure surface is never reached and this test proves nothing.
    expect(pages.length).toBeGreaterThan(1);

    // Assert the SET, never a count: a paginator returning the wrong rows can
    // satisfy a count.
    expect(new Set(delivered).size).toBe(delivered.length); // no duplicates
    expect(delivered.slice().sort((a, b) => a - b)).toEqual(seeded);
    expect(pages.filter((p) => p.skipped_count > 0).length).toBe(0);
  });

  test("accounting invariant: shown + skipped equals the population", () => {
    seedMixedChannel("cursor-accounting", 30);
    const pages = pageFollowingNextCursor("cursor-accounting", 1400);

    const totalShown = pages.reduce((n, p) => n + p.shown, 0);
    const totalSkipped = pages.reduce((n, p) => n + p.skipped_count, 0);

    // NOTE: this invariant held even while the paginator was losing a message
    // per truncated page, because the loss was honestly counted in
    // skipped_count. It catches UNACCOUNTED loss; it cannot catch a cursor that
    // steps past a message it just reported. The completeness assertion in the
    // test above is the one that catches that. Both are kept deliberately.
    expect(totalShown + totalSkipped).toBe(pages[0].total_available);
  });

  test("a message that does not fit alongside is DEFERRED, not skipped", () => {
    // Small message first, big-sender second. Measured on this fixture: at 900
    // bytes the second does not fit ALONGSIDE the first but fits fine on a page
    // of its own. That is a page boundary, not a property of the message, so it
    // must be deferred and delivered next page.
    const first = sendMessage({ from: "a", to: "defer", channel: "defer", content: "first" });
    const second = sendMessage({
      from: "agent-" + "x".repeat(200),
      to: "defer",
      channel: "defer",
      content: "second",
    });

    const page1 = readDigest({ channel: "defer", max_bytes: 900 });
    expect(page1.message_ids).toEqual([first.id]);
    expect(page1.skipped_count).toBe(0);
    expect(page1.next_cursor).toBe(first.id); // last DELIVERED, not the deferred one
    expect(page1.has_more).toBe(true);

    const page2 = readDigest({ channel: "defer", cursor: page1.next_cursor ?? undefined, max_bytes: 900 });
    expect(page2.message_ids).toEqual([second.id]);
    expect(page2.skipped_count).toBe(0);
    expect(page2.has_more).toBe(false);
  });

  test("a message that cannot fit even alone IS skipped, and says so", () => {
    // Same fixture, tighter cap. Measured: at 700 bytes the second message
    // cannot be rendered even with an empty snippet on an otherwise empty page.
    // Advancing past it is the only way to make progress, so this is the one
    // case where next_cursor legitimately exceeds the last delivered id — and
    // skipped_count reports it.
    const first = sendMessage({ from: "a", to: "defer", channel: "defer", content: "first" });
    const second = sendMessage({
      from: "agent-" + "x".repeat(200),
      to: "defer",
      channel: "defer",
      content: "second",
    });

    const page1 = readDigest({ channel: "defer", max_bytes: 700 });
    expect(page1.message_ids).toEqual([first.id]);
    expect(page1.skipped_count).toBe(0);
    expect(page1.next_cursor).toBe(first.id);

    const page2 = readDigest({ channel: "defer", cursor: page1.next_cursor ?? undefined, max_bytes: 700 });
    expect(page2.message_ids).toEqual([]);
    expect(page2.skipped_count).toBe(1);
    expect(page2.next_cursor).toBe(second.id);
    expect(page2.has_more).toBe(false);
  });

  test("the envelope states how its own cursor must be consumed", () => {
    sendMessage({ from: "a", to: "semantics", channel: "semantics", content: "hello" });
    const page = readDigest({ channel: "semantics" });
    expect(page.cursor_semantics).toBe("exclusive");
  });

  // --- negative side: the cursor must actually be honoured -------------------
  // A fix that returns everything could also be a fix that ignores the cursor.
  // These two assertions make that indistinguishable outcome distinguishable.

  test("a cursor mid-population returns strictly fewer messages", () => {
    const ids = seedMixedChannel("cursor-mid", 20);
    const all = readDigest({ channel: "cursor-mid", max_bytes: 65536 });
    const mid = ids[Math.floor(ids.length / 2)];
    const after = readDigest({ channel: "cursor-mid", cursor: mid, max_bytes: 65536 });

    expect(after.shown).toBeLessThan(all.shown);
    expect(after.message_ids.every((id) => id > mid)).toBe(true);
    expect(after.total_available).toBeLessThan(all.total_available);
  });

  // --- the other digest surfaces --------------------------------------------
  // `assembleDigest` is shared by every filter, so these ought to behave
  // identically. "Ought to" is not evidence, and the lane that found this defect
  // explicitly flagged --to / --session / --unread as UNMEASURED, so each one is
  // exercised here rather than inferred from the shared code path.

  test("--to paging delivers every message exactly once", () => {
    const ids: number[] = [];
    for (let i = 0; i < 30; i++) {
      const long = i % 3 === 0;
      ids.push(sendMessage({
        from: "agent-" + "x".repeat(long ? 120 : 2),
        to: "dm-target",
        content: long ? `long-${i} ${"y".repeat(400)}` : `short-${i}`,
      }).id);
    }

    const pages: DigestResult[] = [];
    let cursor: number | undefined;
    for (let guard = 0; guard < 200; guard++) {
      const page = readDigest({ to: "dm-target", max_bytes: 1400, cursor });
      pages.push(page);
      if (!page.has_more) break;
      cursor = page.next_cursor ?? undefined;
    }

    const delivered = pages.flatMap((p) => p.message_ids);
    expect(pages.length).toBeGreaterThan(1);
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(delivered.slice().sort((a, b) => a - b)).toEqual(ids);
  });

  test("--session paging delivers every message exactly once", () => {
    const ids: number[] = [];
    for (let i = 0; i < 30; i++) {
      const long = i % 3 === 0;
      ids.push(sendMessage({
        from: "agent-" + "x".repeat(long ? 120 : 2),
        to: "peer",
        session_id: "sess-fixture",
        content: long ? `long-${i} ${"y".repeat(400)}` : `short-${i}`,
      }).id);
    }

    const pages: DigestResult[] = [];
    let cursor: number | undefined;
    for (let guard = 0; guard < 200; guard++) {
      const page = readDigest({ session_id: "sess-fixture", max_bytes: 1400, cursor });
      pages.push(page);
      if (!page.has_more) break;
      cursor = page.next_cursor ?? undefined;
    }

    const delivered = pages.flatMap((p) => p.message_ids);
    expect(pages.length).toBeGreaterThan(1);
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(delivered.slice().sort((a, b) => a - b)).toEqual(ids);
  });

  test("--unread paging delivers every unread message exactly once", () => {
    const ids = seedMixedChannel("cursor-complete", 30);

    const pages: DigestResult[] = [];
    let cursor: number | undefined;
    for (let guard = 0; guard < 200; guard++) {
      const page = readDigest({ channel: "cursor-complete", unread_only: true, max_bytes: 1400, cursor });
      pages.push(page);
      if (!page.has_more) break;
      cursor = page.next_cursor ?? undefined;
    }

    const delivered = pages.flatMap((p) => p.message_ids);
    expect(pages.length).toBeGreaterThan(1);
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(delivered.slice().sort((a, b) => a - b)).toEqual(ids);
  });

  test("a cursor past every row returns zero", () => {
    const ids = seedMixedChannel("cursor-past", 10);
    const past = readDigest({ channel: "cursor-past", cursor: Math.max(...ids), max_bytes: 65536 });

    expect(past.shown).toBe(0);
    expect(past.message_ids).toEqual([]);
    expect(past.total_available).toBe(0);
    expect(past.has_more).toBe(false);
  });
});
