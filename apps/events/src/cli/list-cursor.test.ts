import { describe, expect, test } from "bun:test";
import { applyFullEventLimit, eventListSnapshotPage } from "./list-cursor.js";

const event = (id: string) => ({ id, source: "test", type: "item", time: `2026-09-18T00:00:0${id}.000Z`, severity: "info", data: {}, schemaVersion: "1" }) as any;

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

  test("binds cursors to filters and identities", () => {
    const first = eventListSnapshotPage([event("1"), event("2")], { limit: 1, type: "item" });
    expect(() => eventListSnapshotPage([event("1"), event("2")], { limit: 1, cursor: first.next_cursor!, type: "other" })).toThrow(/filter mismatch/);
    expect(() => eventListSnapshotPage([event("1")], { limit: 1, cursor: first.next_cursor!, type: "item" })).toThrow(/snapshot/);
  });
  test("full output preserves explicit limits above the compact cap", () => {
    const rows = Array.from({ length: 1600 }, (_, index) => index);
    expect(applyFullEventLimit(rows, 1500)).toHaveLength(1500);
    expect(applyFullEventLimit(rows, 0)).toHaveLength(1600);
    expect(applyFullEventLimit(rows, undefined)).toHaveLength(1600);
  });

});
