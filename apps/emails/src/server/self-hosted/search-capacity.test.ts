import { expect, test } from "bun:test";
import { runMessageListQuery, MessageSearchBusyError, MessageSearchAdmission, createMessageSearchAdmission } from "./search-admission.js";

test("default search capacity admits eight simultaneous authenticated store queries and bounds overload", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = 0;
  const queries = Array.from({ length: 8 }, (_, index) => runMessageListQuery({
    search: "synthetic-capacity-fixture", tenantId: `tenant-${index}`,
    scopedClient: {} as any,
    query: async () => { started++; await gate; return index; },
  }).then(value => ({ ok: true, value }), error => ({ ok: false, error })));
  try {
    expect(started).toBe(8);
    let overloadStarted = false;
    await expect(runMessageListQuery({ search: "overflow", tenantId: "tenant-overflow", scopedClient: {} as any,
      query: async () => { overloadStarted = true; return "unexpected"; },
    })).rejects.toBeInstanceOf(MessageSearchBusyError);
    expect(overloadStarted).toBe(false);
    expect(await runMessageListQuery({ tenantId: "ordinary", scopedClient: {} as any, query: async () => "ordinary read" })).toBe("ordinary read");
  } finally { release(); await Promise.all(queries); }
  expect((await Promise.all(queries)).every(result => result.ok)).toBe(true);
});


test("search configuration preserves pool headroom and rejects malformed or excessive budgets", () => {
  for (const [pool, expected] of [[1, 1], [2, 1], [4, 3], [10, 8], [64, 8]]) {
    expect(createMessageSearchAdmission({}, pool!).limit).toBe(expected!);
  }
  expect(createMessageSearchAdmission({ EMAILS_SEARCH_CONCURRENCY: "16" }, 20).limit).toBe(16);
  expect(createMessageSearchAdmission({ EMAILS_SEARCH_CONCURRENCY: "64" }, 65).limit).toBe(64);
  for (const value of ["", "0", "-1", "1.5", " 8", "8 ", "08", "8e0", "NaN", "Infinity", "65", "9999999999999999999999"]) {
    expect(() => createMessageSearchAdmission({ EMAILS_SEARCH_CONCURRENCY: value }, 100)).toThrow();
  }
  expect(() => createMessageSearchAdmission({ EMAILS_SEARCH_CONCURRENCY: "10" }, 10)).toThrow("PostgreSQL search budget");
  expect(() => createMessageSearchAdmission({ EMAILS_SEARCH_CONCURRENCY: "8" }, 8)).toThrow();
  for (const pool of [0, -1, 1.5, Infinity, NaN]) expect(() => createMessageSearchAdmission({}, pool)).toThrow("EMAILS_PG_POOL_MAX");
  for (const value of [0, -1, 1.5, 65, Infinity, NaN]) expect(() => new MessageSearchAdmission(value)).toThrow();
});

test("configured sixteen-slot admission remains shared and reusable through repeated bursts", async () => {
  const admission = createMessageSearchAdmission({ EMAILS_SEARCH_CONCURRENCY: "16" }, 20);
  for (let round = 0; round < 3; round++) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    const run = (query: () => Promise<number>) => runMessageListQuery({ search: "fixture", tenantId: "tenant", scopedClient: {} as any, admission, query });
    const pending = Array.from({ length: 16 }, (_, n) => run(async () => { started++; await gate; return n; }));
    try {
      expect(started).toBe(16);
      await expect(run(async () => { started++; return -1; })).rejects.toBeInstanceOf(MessageSearchBusyError);
      expect(started).toBe(16);
    } finally { release(); await Promise.all(pending); }
  }
});
