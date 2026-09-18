import { describe, expect, test } from "bun:test";
import {
  COMPACT_EVENT_FIELD_MAX_BYTES,
  DEFAULT_COMPACT_EVENT_LIST_MAX_BYTES,
  applyFullEventLimit,
  compactEventListOutput,
  eventListSnapshotPage,
} from "./list-cursor.js";

const event = (id: string, occurrence: string | number = id) => ({
  id,
  source: "test",
  type: "item",
  time: `2026-09-18T00:00:00.${String(occurrence).padStart(3, "0")}Z`,
  severity: "info",
  data: { occurrence },
  schemaVersion: "1",
}) as any;

const occurrence = (page: ReturnType<typeof eventListSnapshotPage>) => page.events.map((row) => row.data.occurrence);

describe("event list snapshot cursor", () => {
  test("does not shift when new events append between pages", () => {
    const initial = [event("1"), event("2"), event("3"), event("4"), event("5")];
    const first = eventListSnapshotPage(initial, { limit: 2, source: "test" });
    expect(first.events.map((row) => row.id)).toEqual(["4", "5"]);
    const second = eventListSnapshotPage([...initial, event("6")], { limit: 2, cursor: first.next_cursor!, source: "test" });
    expect(second.events.map((row) => row.id)).toEqual(["2", "3"]);
    expect(second.snapshot_id).toBe("5");
    expect(second.total).toBe(5);
  });

  test("pages losslessly across multiple duplicate event ids at limit one", () => {
    const duplicates = [event("duplicate", 1), event("duplicate", 2), event("duplicate", 3), event("duplicate", 4)];
    const first = eventListSnapshotPage(duplicates, { limit: 1, type: "item" });
    const second = eventListSnapshotPage(duplicates, { limit: 1, cursor: first.next_cursor!, type: "item" });
    const third = eventListSnapshotPage(duplicates, { limit: 1, cursor: second.next_cursor!, type: "item" });
    const fourth = eventListSnapshotPage(duplicates, { limit: 1, cursor: third.next_cursor!, type: "item" });

    expect([first, second, third, fourth].flatMap(occurrence)).toEqual([4, 3, 2, 1]);
    expect([first.total, second.total, third.total, fourth.total]).toEqual([4, 4, 4, 4]);
    expect(new Set([first.next_cursor, second.next_cursor, third.next_cursor]).size).toBe(3);
    expect(fourth.next_cursor).toBeNull();
    expect(fourth.has_more).toBe(false);
  });

  test("keeps a duplicate-id snapshot append-safe while more duplicates append concurrently", () => {
    const initial = [event("duplicate", 1), event("duplicate", 2), event("duplicate", 3)];
    const first = eventListSnapshotPage(initial, { limit: 1, source: "test" });
    const afterAppend = [...initial, event("duplicate", 4), event("later", 5)];
    const second = eventListSnapshotPage(afterAppend, { limit: 1, cursor: first.next_cursor!, source: "test" });
    const afterAnotherAppend = [...afterAppend, event("duplicate", 6)];
    const third = eventListSnapshotPage(afterAnotherAppend, { limit: 1, cursor: second.next_cursor!, source: "test" });

    expect([first, second, third].flatMap(occurrence)).toEqual([3, 2, 1]);
    expect([first.total, second.total, third.total]).toEqual([3, 3, 3]);
    expect(second.snapshot_id).toBe("duplicate");
    expect(third.next_cursor).toBeNull();
  });

  test("binds cursors to filters, positions, and identities", () => {
    const first = eventListSnapshotPage([event("1"), event("2")], { limit: 1, type: "item" });
    expect(() => eventListSnapshotPage([event("1"), event("2")], { limit: 1, cursor: first.next_cursor!, type: "other" })).toThrow(/filter mismatch/);
    expect(() => eventListSnapshotPage([event("1")], { limit: 1, cursor: first.next_cursor!, type: "item" })).toThrow(/snapshot/);
    expect(() => eventListSnapshotPage([event("1"), event("different")], { limit: 1, cursor: first.next_cursor!, type: "item" })).toThrow(/snapshot/);
  });


  test("enforces an exact byte ceiling while bounding every compact string field", () => {
    const hostile = "\0".repeat(2_000);
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `event-${String(index).padStart(2, "0")}-${hostile}`,
      time: `time-${index}-${hostile}`,
      source: `source-${index}-${hostile}`,
      type: `type-${index}-${hostile}`,
      severity: `severity-${index}-${hostile}`,
      subject: `subject-${index}-${hostile}`,
      message: `message ${index} ${hostile}`,
      schemaVersion: `schema-${index}-${hostile}`,
      data: {},
    })) as any[];

    const page = compactEventListOutput(rows, { limit: 20 });
    const serialized = `${JSON.stringify(page, null, 2)}\n`;

    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(DEFAULT_COMPACT_EVENT_LIST_MAX_BYTES);
    expect(page.max_bytes).toBe(DEFAULT_COMPACT_EVENT_LIST_MAX_BYTES);
    expect(page.fields_truncated).toBe(true);
    expect(page.byte_limited).toBe(true);
    expect(page.count).toBeGreaterThan(0);
    expect(page.count).toBeLessThan(20);
    for (const row of page.events) {
      for (const [field, maxBytes] of Object.entries(COMPACT_EVENT_FIELD_MAX_BYTES)) {
        const value = row[field as keyof typeof row];
        if (value !== null) expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(maxBytes);
      }
    }
    expect(Buffer.byteLength(page.snapshot_id!, "utf8")).toBeLessThanOrEqual(COMPACT_EVENT_FIELD_MAX_BYTES.id);
  });

  test("byte-limited compact pages walk every append occurrence without overlap", () => {
    const hostile = "\0".repeat(2_000);
    const rows = Array.from({ length: 25 }, (_, index) => ({
      ...event("duplicate", index),
      id: `duplicate-${String(index).padStart(2, "0")}-${hostile}`,
      subject: hostile,
      message: hostile,
    })) as any[];
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = compactEventListOutput(rows, { limit: 20, cursor, source: "test" });
      expect(Buffer.byteLength(`${JSON.stringify(page, null, 2)}\n`, "utf8")).toBeLessThanOrEqual(DEFAULT_COMPACT_EVENT_LIST_MAX_BYTES);
      seen.push(...page.events.map((row) => row.id.slice(0, "duplicate-00".length)));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);

    expect([...seen].sort()).toEqual(Array.from({ length: 25 }, (_, index) => `duplicate-${String(index).padStart(2, "0")}`));
    expect(new Set(seen).size).toBe(25);
  });

  test("full output preserves explicit limits above the compact cap", () => {
    const rows = Array.from({ length: 1600 }, (_, index) => index);
    expect(applyFullEventLimit(rows, 1500)).toHaveLength(1500);
    expect(applyFullEventLimit(rows, 0)).toHaveLength(1600);
    expect(applyFullEventLimit(rows, undefined)).toHaveLength(1600);
  });
});
