import { describe, expect, test } from "bun:test";
import { CollectionCursorError, pageStableCollection } from "./collection-cursor.js";

interface Row { id: string; name: string }
const compare = (left: Row, right: Row) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
const page = (rows: Row[], cursor?: string, filter: unknown = { query: "projects" }) => pageStableCollection(rows, {
  collection: "projects",
  filter,
  limit: 2,
  cursor,
  identity: (row) => row.id,
  compare,
});

describe("opaque collection cursors", () => {
  test("duplicate names page by immutable identity without overlap", () => {
    const rows = [
      { id: "wks_c", name: "Same" },
      { id: "wks_a", name: "Same" },
      { id: "wks_b", name: "Same" },
    ];
    const first = page(rows);
    expect(first.items.map((row) => row.id)).toEqual(["wks_a", "wks_b"]);
    const cursor = first.cursorForCount(first.items.length);
    expect(cursor).toBeString();
    const second = page(rows, cursor!);
    expect(second.items.map((row) => row.id)).toEqual(["wks_c"]);
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(3);
    expect(second.cursorForCount(second.items.length)).toBeNull();
  });

  test("refuses insertions, deletions, and sort-key reorders between pages", () => {
    const initial = [
      { id: "wks_a", name: "Alpha" },
      { id: "wks_b", name: "Beta" },
      { id: "wks_c", name: "Gamma" },
    ];
    const cursor = page(initial).cursorForCount(2)!;
    for (const changed of [
      [...initial, { id: "wks_d", name: "Delta" }],
      initial.filter((row) => row.id !== "wks_a"),
      initial.map((row) => row.id === "wks_c" ? { ...row, name: "Aardvark" } : row),
    ]) {
      expect(() => page(changed, cursor)).toThrow(CollectionCursorError);
      expect(() => page(changed, cursor)).toThrow(/collection changed|identity boundary/);
    }
  });

  test("binds cursors to collection filters and rejects tampering", () => {
    const rows = [
      { id: "wks_a", name: "Alpha" },
      { id: "wks_b", name: "Beta" },
      { id: "wks_c", name: "Gamma" },
    ];
    const cursor = page(rows).cursorForCount(2)!;
    expect(() => page(rows, cursor, { query: "other" })).toThrow(/filter/);
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    expect(() => page(rows, tampered)).toThrow(/checksum|encoding/);
  });
});
