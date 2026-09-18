import { describe, expect, test } from "bun:test";
import { applyFullEventLimit, eventListSnapshotPage } from "./list-cursor.js";

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

  test("full output preserves explicit limits above the compact cap", () => {
    const rows = Array.from({ length: 1600 }, (_, index) => index);
    expect(applyFullEventLimit(rows, 1500)).toHaveLength(1500);
    expect(applyFullEventLimit(rows, 0)).toHaveLength(1600);
    expect(applyFullEventLimit(rows, undefined)).toHaveLength(1600);
  });
});
