import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { changedSinceStampNewer } from "./instant-compare.js";

describe("changedSinceStampNewer", () => {
  const CURSOR = "2026-08-20T21:00:00.000Z";

  test("ISO stamps compare as instants", () => {
    expect(changedSinceStampNewer("2026-08-20T22:00:00.000Z", CURSOR)).toBe(true);
    expect(changedSinceStampNewer("2026-08-20T20:00:00.000Z", CURSOR)).toBe(false);
    expect(changedSinceStampNewer("2026-08-20T21:00:00.000Z", CURSOR)).toBe(false); // equal, not newer
  });

  test("space-form stamps are read as UTC and newer ones are included", () => {
    // The measured defect: "2026-08-20 23:00:00" < "2026-08-20T21:00:00.000Z"
    // as TEXT, but as instants it is newer.
    expect(changedSinceStampNewer("2026-08-20 23:00:00", CURSOR)).toBe(true);
    expect(changedSinceStampNewer("2026-08-20 20:00:00", CURSOR)).toBe(false);
    expect(changedSinceStampNewer("2026-08-21 01:00:00", CURSOR)).toBe(true);
  });

  test("an unparseable row stamp is KEPT (cannot read is not older)", () => {
    expect(changedSinceStampNewer("not-a-timestamp", CURSOR)).toBe(true);
    expect(changedSinceStampNewer("", CURSOR)).toBe(true);
  });

  test("an unparseable cursor excludes parseable rows (comparison is NULL)", () => {
    expect(changedSinceStampNewer("2026-08-20T22:00:00.000Z", "garbage")).toBe(false);
    // ...but an unparseable ROW against an unparseable cursor is still kept.
    expect(changedSinceStampNewer("not-a-timestamp", "garbage")).toBe(true);
  });

  test("REGRESSION (review finding): SQLite reads lowercase t/z as NULL, so the row is KEPT", () => {
    // Date.parse accepts "2026-08-20t20:00:00z" and would exclude it as older
    // than the cursor; julianday() returns NULL for it, so the row is kept.
    expect(changedSinceStampNewer("2026-08-20t20:00:00z", "2026-08-20T23:00:00.000Z")).toBe(true);
    expect(changedSinceStampNewer("2026-08-20t20:00:00z", CURSOR)).toBe(true);
  });

  test("REGRESSION (review finding): sub-millisecond stamps compare at microsecond precision", () => {
    // Date.parse truncates ".0009Z" and ".0001Z" to the same millisecond, so
    // a raw Date.parse comparison would exclude the newer row; julianday()
    // distinguishes them.
    expect(changedSinceStampNewer("2026-08-20T20:00:00.0009Z", "2026-08-20T20:00:00.0001Z")).toBe(true);
    expect(changedSinceStampNewer("2026-08-20T20:00:00.0001Z", "2026-08-20T20:00:00.0009Z")).toBe(false);
  });

  test("REGRESSION (review finding): out-of-range calendar fields are unparseable, not normalized", () => {
    // Date.UTC normalizes month 13 -> next January; julianday() returns NULL.
    expect(changedSinceStampNewer("2026-13-20", CURSOR)).toBe(true);
    expect(changedSinceStampNewer("2026-08-32", CURSOR)).toBe(true);
    expect(changedSinceStampNewer("2026-08-20T25:00:00", CURSOR)).toBe(true);
    expect(changedSinceStampNewer("2026-08-20T20:00:61Z", CURSOR)).toBe(true);
  });

  test("offset stamps apply the offset by subtraction, matching julianday", () => {
    // julianday('2026-08-20T20:00:00+02:00') == julianday('2026-08-20T18:00:00Z').
    expect(changedSinceStampNewer("2026-08-20T18:00:00+02:00", "2026-08-20T19:00:00.000Z")).toBe(false); // 16:00Z vs 19:00Z
    expect(changedSinceStampNewer("2026-08-20T20:00:00+02:00", "2026-08-20T19:00:00.000Z")).toBe(false); // 18:00Z vs 19:00Z
    expect(changedSinceStampNewer("2026-08-20T21:00:00+02:00", "2026-08-20T19:00:00.000Z")).toBe(false); // 19:00Z vs 19:00Z: equal, not newer
    expect(changedSinceStampNewer("2026-08-20T22:00:00+02:00", "2026-08-20T19:00:00.000Z")).toBe(true); // 20:00Z vs 19:00Z
  });

  test("date-only stamps read as midnight UTC", () => {
    expect(changedSinceStampNewer("2026-08-21", "2026-08-20T23:00:00.000Z")).toBe(true);
    expect(changedSinceStampNewer("2026-08-20", CURSOR)).toBe(false);
  });

  test("differential: matches real SQLite julianday() over a stamp matrix", () => {
    const db = new Database(":memory:");
    const stamps = [
      "2026-08-20T22:00:00.000Z",
      "2026-08-20 23:00:00",
      "2026-08-20T20:00:00.0009Z",
      "2026-08-20T20:00:00.0001Z",
      "2026-08-20T20:00:00.123456Z",
      "2026-08-20t20:00:00z",
      "2026-08-20T20:00:00+02:00",
      "2026-08-20T20:00:00+0200",
      "2026-08-21",
      "2026-08-20",
      "2026-13-20",
      "2026-08-32",
      "2026-08-20T25:00:00",
      "2026-08-20T20:00:61Z",
      "not-a-timestamp",
      "",
    ];
    // The exact predicate the SQL paths use: a row whose stamp julianday()
    // cannot parse is KEPT; otherwise the instants are compared.
    const stmt = db.query(
      "SELECT CASE WHEN julianday(?) IS NULL THEN 1 ELSE COALESCE(julianday(?) > julianday(?), 0) END AS r",
    );
    for (const rowStamp of stamps) {
      for (const cursor of stamps) {
        const expected = (stmt.get(rowStamp, rowStamp, cursor) as { r: number }).r;
        expect(changedSinceStampNewer(rowStamp, cursor) ? 1 : 0, `${JSON.stringify(rowStamp)} vs ${JSON.stringify(cursor)}`).toBe(expected);
      }
    }
  });
});
