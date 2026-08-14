import { describe, expect, test } from "bun:test";
import { genId } from "./ids.js";

describe("genId", () => {
  test("produces 128-bit lowercase hex identifiers", () => {
    const id = genId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  test("is time-sortable across millisecond boundaries", async () => {
    const first = genId();
    await new Promise((resolve) => setTimeout(resolve, 3));
    const second = genId();
    expect(first < second).toBe(true);
  });

  test("does not collide across many generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) seen.add(genId());
    expect(seen.size).toBe(10_000);
  });

  test("encodes the creation time in the fixed-width sortable prefix", () => {
    const before = Date.now();
    const id = genId();
    const after = Date.now();
    const encoded = Number.parseInt(id.slice(0, 12), 16);
    expect(encoded).toBeGreaterThanOrEqual(before);
    expect(encoded).toBeLessThanOrEqual(after);
  });

  test("burst-generated ids stay unique and keep time prefixes in creation order", () => {
    const ids: string[] = [];
    for (let i = 0; i < 5_000; i += 1) ids.push(genId());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length === 32)).toBe(true);
    // Sorting lexicographically must never order a later-millisecond id
    // before an earlier-millisecond one.
    const byTime = ids.map((id) => id.slice(0, 12));
    const sorted = [...byTime].sort();
    expect(byTime).toEqual(sorted);
  });
});
