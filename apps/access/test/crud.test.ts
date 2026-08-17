import { describe, expect, it } from "bun:test";

import { clampLimit, clampOffset, parseJson, resolvePartialId } from "../src/db/crud.js";

describe("JSON row parsing", () => {
  it("returns parsed objects, arrays, and primitive values", () => {
    expect(parseJson('{"enabled":true}', {})).toEqual({ enabled: true });
    expect(parseJson('["read","write"]', [])).toEqual(["read", "write"]);
    expect(parseJson("0", 99)).toBe(0);
    expect(parseJson("false", true)).toBe(false);
  });

  it("uses the caller's fallback for nullish or malformed stored values", () => {
    const fallback = { safe: true };
    expect(parseJson(null, fallback)).toBe(fallback);
    expect(parseJson(undefined as never, fallback)).toBe(fallback);
    expect(parseJson("{not-json", fallback)).toBe(fallback);
  });
});

describe("pagination normalization", () => {
  it("accepts positive integer numbers and integer strings", () => {
    expect(clampLimit(25)).toBe(25);
    expect(clampLimit(" 25 ")).toBe(25);
    expect(clampOffset(12)).toBe(12);
    expect(clampOffset(" 12 ")).toBe(12);
  });

  it("normalizes fractional numbers before they reach SQLite LIMIT/OFFSET", () => {
    expect(clampLimit(9.9)).toBe(9);
    expect(clampLimit(0.9, 20)).toBe(20);
    expect(clampOffset(9.9)).toBe(9);
    expect(clampOffset(-0.9)).toBe(0);
  });

  it("uses safe defaults for nullish, non-finite, zero, and negative limits", () => {
    for (const value of [undefined, null, "", "not-a-number", Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(clampLimit(value, 37)).toBe(37);
    }
  });

  it("caps limits and normalizes invalid offsets to zero", () => {
    expect(clampLimit(501)).toBe(500);
    expect(clampLimit(100, 50, 40)).toBe(40);
    for (const value of [undefined, null, "", "not-a-number", Number.NaN, Number.NEGATIVE_INFINITY, -1]) {
      expect(clampOffset(value)).toBe(0);
    }
  });
});

describe("partial ID resolution", () => {
  const exactId = "11111111-1111-4111-8111-111111111111";

  it("uses exact matching for full IDs", () => {
    const calls: Array<{ sql: string; value: string }> = [];
    const db = {
      query(sql: string) {
        return {
          get(value: string) {
            calls.push({ sql, value });
            return { id: exactId };
          },
        };
      },
    } as unknown as Parameters<typeof resolvePartialId>[0];

    expect(resolvePartialId(db, "identities", exactId)).toBe(exactId);
    expect(calls).toEqual([{ sql: "SELECT id FROM identities WHERE id = ?", value: exactId }]);
  });

  it("returns the only matching partial ID and appends the wildcard itself", () => {
    const calls: Array<{ sql: string; value: string }> = [];
    const db = {
      query(sql: string) {
        return {
          all(value: string) {
            calls.push({ sql, value });
            return [{ id: exactId }];
          },
        };
      },
    } as unknown as Parameters<typeof resolvePartialId>[0];

    expect(resolvePartialId(db, "credentials", "11111111")).toBe(exactId);
    expect(calls).toEqual([{ sql: "SELECT id FROM credentials WHERE id LIKE ?", value: "11111111%" }]);
  });

  it("fails closed for missing and ambiguous partial IDs", () => {
    const databaseWith = (rows: Array<{ id: string }>) => ({
      query() {
        return { all: () => rows };
      },
    }) as unknown as Parameters<typeof resolvePartialId>[0];

    expect(resolvePartialId(databaseWith([]), "scopes", "missing")).toBeNull();
    expect(resolvePartialId(databaseWith([{ id: exactId }, { id: exactId.replace(/1/g, "2") }]), "scopes", "shared"))
      .toBeNull();
  });

  it("rejects unapproved table names before constructing a query", () => {
    let queried = false;
    const db = {
      query() {
        queried = true;
        throw new Error("query must not run");
      },
    } as unknown as Parameters<typeof resolvePartialId>[0];

    expect(() => resolvePartialId(db, "identities; DROP TABLE audit_log", "1111")).toThrow("Invalid table name");
    expect(queried).toBe(false);
  });
});
