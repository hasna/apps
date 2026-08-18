import { describe, expect, test } from "bun:test";

import {
  decodeCommentCursor,
  encodeCommentCursor,
  isStrictlyOlder,
  pageComments,
  MAX_COMMENT_CURSOR_LENGTH,
} from "./comment-cursor.js";

/**
 * Direct coverage for the shared comment keyset codec and pure pager.
 *
 * WHY THIS FILE EXISTS. `comment-cursor.ts` is the single shared definition of
 * what a comment cursor MEANS — both the `/v1` server and the CLI import it —
 * and until now it had no test of its own. It was exercised only end to end
 * through the CLI suite, so the pager's completeness invariant and every
 * rejection branch of the decoder were unguarded.
 *
 * THE INVARIANT UNDER TEST, and it is the one that matters operationally:
 * paging to exhaustion must return EVERY comment exactly once, and `has_more`
 * must stay true until it genuinely is not. `has_more` is the only completeness
 * signal a consumer is told to trust, so an under-read here is silent by
 * construction — the caller pages correctly, stops when told to, and holds a
 * fraction of the record with nothing to indicate it. Reported as todos
 * `25feb6cf` after a coordinator was said to hold ~60% of a 260-comment row.
 *
 * That specific report did NOT reproduce: measured against the live deployment
 * on row `be24ce58`, every read path agreed at 162 comments — the CLI paged to
 * exhaustion at limit=100 and at limit=10, a single `--comments-limit 500` call,
 * and the raw `GET /v1/tasks/:id/comments?limit=500` endpoint, with the paged id
 * set identical to the authoritative set (0 missing, 0 extra). These tests are
 * therefore a GUARD rather than a fix: they exist so that a future regression of
 * that shape fails loudly here instead of being rediscovered by a coordinator
 * who cannot tell a complete read from a truncated one.
 */

interface Fixture {
  id: string;
  created_at: string;
}

/** Ascending, distinct timestamps — the ordinary case. */
function makeComments(total: number, startMs = Date.UTC(2026, 7, 15, 12, 0, 0)): Fixture[] {
  return Array.from({ length: total }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    created_at: new Date(startMs + index * 1_000).toISOString(),
  }));
}

/**
 * Walk every page the way the discipline requires — follow `next_cursor` while
 * `has_more`, and stop the instant it goes false. Returns what such a consumer
 * would actually end up holding, plus enough shape to assert on.
 */
function walkToExhaustion(all: readonly Fixture[], limit: number) {
  const collected: Fixture[] = [];
  const pageSizes: number[] = [];
  const hasMoreFlags: boolean[] = [];
  let before: { created_at: string; id: string } | undefined;

  // Bound the walk well above any legitimate page count so a cursor that fails
  // to advance surfaces as a loop-guard trip rather than hanging the suite.
  for (let guard = 0; guard <= all.length + 5; guard += 1) {
    const page = pageComments(all, { limit, ...(before ? { before } : {}) });
    // A page is ascending, and the walk moves toward OLDER history, so each
    // page belongs in front of everything collected so far.
    collected.unshift(...page.comments);
    pageSizes.push(page.count);
    hasMoreFlags.push(page.has_more);

    expect(page.count).toBe(page.comments.length);
    expect(page.limit).toBe(limit);
    // has_more and next_cursor must agree in both directions; one without the
    // other is how a walk either stops early or spins.
    expect(page.next_cursor === null).toBe(!page.has_more);

    if (!page.has_more) {
      return { collected, pageSizes, hasMoreFlags };
    }
    before = decodeCommentCursor(page.next_cursor!);
  }
  throw new Error("cursor walk failed to terminate");
}

describe("pageComments walks the whole history", () => {
  // The row's own stated acceptance: "a row with >155 comments must page to a
  // count equal to its true total, and has_more must be true until it is not."
  test("a 260-comment history pages to exactly 260 — the case reported as under-reading", () => {
    const all = makeComments(260);
    const { collected, hasMoreFlags } = walkToExhaustion(all, 100);

    expect(collected.length).toBe(260);
    expect(new Set(collected.map((c) => c.id)).size).toBe(260);
    // Every page but the last must claim more is available.
    expect(hasMoreFlags).toEqual([true, true, false]);
  });

  test("the walk returns the authoritative set exactly — no gap, no repeat", () => {
    const all = makeComments(260);
    const authoritative = new Set(all.map((c) => c.id));
    const collected = walkToExhaustion(all, 100).collected;
    const paged = new Set(collected.map((c) => c.id));

    expect([...authoritative].filter((id) => !paged.has(id))).toEqual([]);
    expect([...paged].filter((id) => !authoritative.has(id))).toEqual([]);
    expect(collected.map((c) => c.id)).toEqual(all.map((c) => c.id));
  });

  // Page size must not change the answer. A defect that only bites at one page
  // size — a cap applied after the cursor is computed, say — hides from a suite
  // that only ever exercises the default.
  test.each([1, 2, 3, 7, 10, 99, 100, 101, 259, 260, 261, 500])(
    "limit=%i still yields the complete 260-comment history",
    (limit) => {
      const all = makeComments(260);
      const { collected } = walkToExhaustion(all, limit);
      expect(collected.length).toBe(260);
      expect(collected.map((c) => c.id)).toEqual(all.map((c) => c.id));
    },
  );

  test("has_more is false exactly when the history fits in one page", () => {
    expect(pageComments(makeComments(100), { limit: 100 }).has_more).toBe(false);
    expect(pageComments(makeComments(100), { limit: 101 }).has_more).toBe(false);
    expect(pageComments(makeComments(101), { limit: 100 }).has_more).toBe(true);
    // The boundary the reported defect sat on.
    expect(pageComments(makeComments(155), { limit: 100 }).has_more).toBe(true);
    expect(pageComments(makeComments(260), { limit: 100 }).has_more).toBe(true);
  });

  test("an empty history terminates immediately and offers no cursor", () => {
    const page = pageComments([] as Fixture[], { limit: 100 });
    expect(page.comments).toEqual([]);
    expect(page.count).toBe(0);
    expect(page.has_more).toBe(false);
    expect(page.next_cursor).toBeNull();
  });

  test("a page carries the NEWEST comments in ascending order", () => {
    const all = makeComments(260);
    const page = pageComments(all, { limit: 100 });
    // Newest 100 means ids 160..259, displayed oldest-first.
    expect(page.comments[0]!.id).toBe(all[160]!.id);
    expect(page.comments[99]!.id).toBe(all[259]!.id);
    // next_cursor encodes the FIRST (oldest) element of the page.
    expect(decodeCommentCursor(page.next_cursor!)).toEqual({
      created_at: all[160]!.created_at,
      id: all[160]!.id,
    });
  });

  test("an unsorted input is still paged completely", () => {
    const all = makeComments(260);
    const shuffled = [...all].reverse();
    const { collected } = walkToExhaustion(shuffled, 100);
    expect(collected.map((c) => c.id)).toEqual(all.map((c) => c.id));
  });
});

describe("pageComments keyset ties", () => {
  /**
   * Every comment sharing one timestamp. The keyset then rests entirely on the
   * id tie-break, so this is where a sort/filter comparator mismatch would drop
   * or repeat a row at a page edge.
   */
  function tiedComments(total: number): Fixture[] {
    const created_at = new Date(Date.UTC(2026, 7, 14, 12, 0, 0)).toISOString();
    return Array.from({ length: total }, (_, index) => ({
      // A distinct id namespace from makeComments, so combining the two
      // fixtures cannot manufacture a duplicate (created_at, id) key. A
      // duplicated key is not a real history — comment ids are unique — and
      // it would fail the ordering assertion below for a reason that says
      // nothing about the pager.
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      created_at,
    }));
  }

  test("260 comments sharing one timestamp still page to exactly 260", () => {
    const all = tiedComments(260);
    const { collected } = walkToExhaustion(all, 100);
    expect(collected.length).toBe(260);
    expect(new Set(collected.map((c) => c.id)).size).toBe(260);
  });

  test("the sort order and the cursor filter agree on every adjacent pair", () => {
    // pageComments SORTS to decide the page window and FILTERS with
    // isStrictlyOlder to decide what a cursor excludes. If those two disagree
    // on any pair, the window and the filter describe different orderings and
    // a row can fall through the gap between pages.
    const all = [...tiedComments(200), ...makeComments(200)];
    const sorted = pageComments(all, { limit: all.length }).comments;
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const current = sorted[index]!;
      expect(isStrictlyOlder(previous, current)).toBe(true);
      expect(isStrictlyOlder(current, previous)).toBe(false);
    }
  });
});

describe("comment cursor codec", () => {
  test("encode/decode round-trips", () => {
    const comment = { id: "abc-123", created_at: "2026-08-15T15:34:13.069Z" };
    expect(decodeCommentCursor(encodeCommentCursor(comment))).toEqual(comment);
  });

  test("the cursor is base64url, so it survives a query string and a shell", () => {
    const encoded = encodeCommentCursor({
      id: "11111111-2222-4333-8444-555555555555",
      created_at: "2026-08-15T15:34:13.069Z",
    });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  // Rejection branches. These had no targeted coverage, and a decoder that
  // accepts junk turns a malformed cursor into a silently wrong page.
  test.each([
    ["not base64 at all", "!!!not-base64!!!"],
    ["valid base64 that is not JSON", Buffer.from("plain text", "utf8").toString("base64url")],
    ["a JSON array", Buffer.from(JSON.stringify([1, 2]), "utf8").toString("base64url")],
    ["JSON null", Buffer.from(JSON.stringify(null), "utf8").toString("base64url")],
    ["a JSON scalar", Buffer.from(JSON.stringify("nope"), "utf8").toString("base64url")],
    ["a missing id", Buffer.from(JSON.stringify({ created_at: "2026-08-15T15:34:13.069Z" }), "utf8").toString("base64url")],
    ["an empty id", Buffer.from(JSON.stringify({ created_at: "2026-08-15T15:34:13.069Z", id: "" }), "utf8").toString("base64url")],
    ["a missing created_at", Buffer.from(JSON.stringify({ id: "abc" }), "utf8").toString("base64url")],
    ["an unparseable created_at", Buffer.from(JSON.stringify({ created_at: "not-a-date", id: "abc" }), "utf8").toString("base64url")],
    ["a non-string created_at", Buffer.from(JSON.stringify({ created_at: 12345, id: "abc" }), "utf8").toString("base64url")],
    ["an over-long id", Buffer.from(JSON.stringify({ created_at: "2026-08-15T15:34:13.069Z", id: "x".repeat(257) }), "utf8").toString("base64url")],
    ["an over-long created_at", Buffer.from(JSON.stringify({ created_at: `2026-08-15T15:34:13.069Z${" ".repeat(64)}`, id: "abc" }), "utf8").toString("base64url")],
  ])("rejects %s", (_label, value) => {
    expect(() => decodeCommentCursor(value)).toThrow("invalid comment cursor");
  });

  test("rejects an over-long cursor before attempting to parse it", () => {
    expect(() => decodeCommentCursor("A".repeat(MAX_COMMENT_CURSOR_LENGTH + 1)))
      .toThrow("invalid comment cursor");
  });

  test("isStrictlyOlder orders on created_at first, then id", () => {
    const older = { created_at: "2026-08-15T00:00:00.000Z", id: "zzz" };
    const newer = { created_at: "2026-08-16T00:00:00.000Z", id: "aaa" };
    expect(isStrictlyOlder(older, newer)).toBe(true);
    expect(isStrictlyOlder(newer, older)).toBe(false);
    // Equal timestamps fall through to the id tie-break.
    expect(isStrictlyOlder({ created_at: older.created_at, id: "aaa" }, { created_at: older.created_at, id: "bbb" })).toBe(true);
    expect(isStrictlyOlder({ created_at: older.created_at, id: "bbb" }, { created_at: older.created_at, id: "aaa" })).toBe(false);
    // A row is never strictly older than itself, or the walk cannot terminate.
    expect(isStrictlyOlder(older, older)).toBe(false);
  });
});
