import { describe, expect, test } from "bun:test";
import { DEFAULT_READ_LIMIT, resolveReadLimit, resolveReadWindow, takeWindow } from "./message-window.js";

// The decision table both stores now share. It lives in one place precisely
// because it used to be written out twice and drifted into todos 2c25973b.
describe("resolveReadWindow", () => {
  test("a bare limit is a recency window: select newest, return chronological", () => {
    expect(resolveReadWindow({ limit: 40 })).toEqual({ select: "desc", reverse: true, newestWindow: true });
  });

  test("no options at all is still a recency window", () => {
    expect(resolveReadWindow()).toEqual({ select: "desc", reverse: true, newestWindow: true });
  });

  test("an explicit order wins and is passed through untouched", () => {
    expect(resolveReadWindow({ order: "asc", limit: 40 })).toEqual({ select: "asc", reverse: false, newestWindow: false });
    expect(resolveReadWindow({ order: "DESC" })).toEqual({ select: "desc", reverse: false, newestWindow: false });
  });

  test("an unrecognised order string is ignored rather than trusted", () => {
    expect(resolveReadWindow({ order: "sideways" }).select).toBe("desc");
    expect(resolveReadWindow({ order: "sideways" }).newestWindow).toBe(true);
  });

  test("latest:N stays newest-first and is never reversed", () => {
    expect(resolveReadWindow({ latest: 5 })).toEqual({ select: "desc", reverse: false, newestWindow: false });
  });

  test("latest:0 is not a latest query", () => {
    expect(resolveReadWindow({ latest: 0 }).newestWindow).toBe(true);
  });

  // `since` is a TIME FILTER answering "what happened since T", not a cursor.
  // It carried the identical defect with its cap defaulted rather than passed:
  // measured on #incidents at 0.5.11, `--since 3h` returned the 20 OLDEST rows
  // of a 110-row window and stopped at id 607270 against a true 608099.
  test("a since filter is a recency window: the newest of the window", () => {
    expect(resolveReadWindow({ since: "2026-07-30T06:00:00Z", limit: 40 })).toEqual({
      select: "desc", reverse: true, newestWindow: true,
    });
  });

  test("a since filter with no limit is still a recency window", () => {
    expect(resolveReadWindow({ since: "3h" }).newestWindow).toBe(true);
  });

  test("an empty since string changes nothing", () => {
    expect(resolveReadWindow({ since: "" }).newestWindow).toBe(true);
  });

  // A since_id IS a cursor. Selection stays ascending there, or a catch-up walk
  // silently skips the middle of a backlog.
  test("a since_id cursor pages forward", () => {
    expect(resolveReadWindow({ since_id: 606944 }).select).toBe("asc");
    expect(resolveReadWindow({ since_id: 606944 }).newestWindow).toBe(false);
  });

  test("since_id: 0 (the poll seed before anything is seen) is a cursor", () => {
    expect(resolveReadWindow({ since_id: 0 }).select).toBe("asc");
  });

  test("an explicit order still beats a since filter", () => {
    expect(resolveReadWindow({ since: "3h", order: "asc" }).select).toBe("asc");
  });
});

// The one cap every read path falls back to, so the CLI can tell a full page
// from a complete answer instead of guessing what the store would have used.
describe("resolveReadLimit", () => {
  test("falls back to the shared default", () => {
    expect(resolveReadLimit()).toBe(DEFAULT_READ_LIMIT);
    expect(resolveReadLimit({})).toBe(DEFAULT_READ_LIMIT);
  });

  test("an explicit positive limit wins", () => {
    expect(resolveReadLimit({ limit: 40 })).toBe(40);
  });

  test("latest outranks limit, matching both stores", () => {
    expect(resolveReadLimit({ limit: 40, latest: 5 })).toBe(5);
  });

  test("non-positive and non-finite values fall back rather than cap at zero", () => {
    expect(resolveReadLimit({ limit: 0 })).toBe(DEFAULT_READ_LIMIT);
    expect(resolveReadLimit({ limit: -3 })).toBe(DEFAULT_READ_LIMIT);
    expect(resolveReadLimit({ limit: Number.NaN })).toBe(DEFAULT_READ_LIMIT);
    expect(resolveReadLimit({ latest: 0, limit: 7 })).toBe(7);
  });

  test("a fractional limit is floored, matching the SQL literal both stores build", () => {
    expect(resolveReadLimit({ limit: 12.9 })).toBe(12);
  });
});

describe("takeWindow", () => {
  const rows = [1, 2, 3, 4];

  test("keeps the tail of a newest-anchored over-fetch", () => {
    expect(takeWindow(rows, 3, true)).toEqual([2, 3, 4]);
  });

  test("keeps the head for every other shape", () => {
    expect(takeWindow(rows, 3, false)).toEqual([1, 2, 3]);
  });

  test("returns everything when there is nothing to trim", () => {
    expect(takeWindow(rows, 4, true)).toEqual(rows);
    expect(takeWindow(rows, 9, true)).toEqual(rows);
  });
});
