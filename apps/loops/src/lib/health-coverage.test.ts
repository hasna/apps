import { describe, expect, test } from "bun:test";
import type { Loop, LoopRun, LoopStatus } from "../types.js";
import { buildHealthReport, HEALTH_ELIGIBLE_STATUSES } from "./health.js";
import { buildHostedHealthReport } from "./hosted-diagnostics.js";
import type { LoopStore } from "./store/index.js";
import { Store } from "./store.js";

/**
 * Coverage regression for `loops health` (task 886f12b7).
 *
 * The defect these tests pin is not that health reported a wrong number — it is
 * that the population bound was applied BEFORE the status filter, so ineligible
 * loops consumed window slots and pushed eligible ones out of the report with no
 * signal. `summary.loops` then reads BELOW the cap while coverage is worse,
 * which is indistinguishable from full coverage to anyone who learned to treat
 * the cap value as the truncation signature.
 *
 * Both stores order by `status ASC` (sqlite store.ts, postgres-loop-storage.ts),
 * and LoopStatus sorts active < expired < paused < stopped. So `expired` loops
 * land BETWEEN active and paused in the window. That is what these fixtures use:
 * it is the reachable case, not a hypothetical one.
 */

const ACTIVE_LOOPS = 5;
const EXPIRED_LOOPS = 100;
const PAUSED_LOOPS = 145;
const ELIGIBLE_LOOPS = ACTIVE_LOOPS + PAUSED_LOOPS;

function seedStatusMix(store: Store): void {
  const make = (name: string, status: LoopStatus): void => {
    const loop = store.createLoop({
      name,
      schedule: { type: "interval", everyMs: 3_600_000 },
      target: { type: "command", command: "true", args: [] },
    });
    if (status !== "active") store.updateLoop(loop.id, { status });
  };
  for (let i = 0; i < ACTIVE_LOOPS; i += 1) make(`active-${i}`, "active");
  for (let i = 0; i < EXPIRED_LOOPS; i += 1) make(`expired-${i}`, "expired");
  for (let i = 0; i < PAUSED_LOOPS; i += 1) make(`paused-${i}`, "paused");
}

describe("loops health population coverage", () => {
  test("ineligible loops must not consume the population window (local store)", () => {
    const store = new Store(":memory:");
    try {
      seedStatusMix(store);

      // Control: the fixture really does exceed the 200-row default window, and
      // the eligible set really is 150. Without this a passing assertion below
      // could just mean the fixture was too small to reach the bound.
      expect(store.countLoops()).toBe(ACTIVE_LOOPS + EXPIRED_LOOPS + PAUSED_LOOPS);
      expect(store.countLoops("active") + store.countLoops("paused")).toBe(ELIGIBLE_LOOPS);
      expect(ACTIVE_LOOPS + EXPIRED_LOOPS + PAUSED_LOOPS).toBeGreaterThan(200);

      const report = buildHealthReport(store);

      // Before the fix: the 200-row slice is 5 active + 100 expired + 95 paused,
      // the status filter then drops the expired ones, and summary.loops reads
      // 100 — under the cap, with 50 paused loops never inspected.
      expect(report.summary.loops).toBe(ELIGIBLE_LOOPS);
      expect(report.expectations).toHaveLength(ELIGIBLE_LOOPS);

      const seenActive = report.expectations.filter((entry) => entry.loop.status === "active").length;
      const seenPaused = report.expectations.filter((entry) => entry.loop.status === "paused").length;
      expect(seenActive).toBe(ACTIVE_LOOPS);
      expect(seenPaused).toBe(PAUSED_LOOPS);
      expect(report.expectations.some((entry) => entry.loop.status === "expired")).toBe(false);
    } finally {
      store.close();
    }
  });

  test("an explicit --limit bounds the ELIGIBLE set, not the raw rows scanned", () => {
    const store = new Store(":memory:");
    try {
      seedStatusMix(store);

      const report = buildHealthReport(store, { limit: 120 });

      // 120 eligible loops, none of them expired. Before the fix the same call
      // returned 20: 120 raw rows = 5 active + 100 expired + 15 paused, of which
      // only 20 survive the status filter.
      expect(report.summary.loops).toBe(120);
      expect(report.expectations.every((entry) => entry.loop.status !== "expired")).toBe(true);
    } finally {
      store.close();
    }
  });

  test("the summary discloses its own bound so a short count cannot read as full coverage", () => {
    const store = new Store(":memory:");
    try {
      seedStatusMix(store);

      const bounded = buildHealthReport(store, { limit: 120 });
      expect(bounded.summary.eligible).toBe(ELIGIBLE_LOOPS);
      expect(bounded.summary.limit).toBe(120);
      expect(bounded.summary.truncated).toBe(true);

      const complete = buildHealthReport(store);
      expect(complete.summary.eligible).toBe(ELIGIBLE_LOOPS);
      expect(complete.summary.truncated).toBe(false);
    } finally {
      store.close();
    }
  });
});

/**
 * A hosted store that honours status/limit/offset the way the real API does,
 * including its silent server-side cap. `optionalLimit` in src/api/index.ts
 * clamps to MAX_PAGE_LIMIT=1000 with no signal, so a client that "fixes" the
 * window by asking for a huge limit is still silently truncated — paging is the
 * only correct answer, and this fake refuses to let a test pretend otherwise.
 */
const SERVER_MAX_PAGE_LIMIT = 1000;
const STATUS_ORDER: LoopStatus[] = ["active", "expired", "paused", "stopped"];

/**
 * Built through the real Store so the fixture is a genuine Loop rather than a
 * hand-written shape that drifts from the type. A partial cast would let this
 * fixture keep compiling after a required field is added, which is how a test
 * stops exercising the thing it names.
 */
const loopTemplate: Loop = (() => {
  const store = new Store(":memory:");
  try {
    return store.createLoop({
      name: "template",
      schedule: { type: "interval", everyMs: 3_600_000 },
      target: { type: "command", command: "true", args: [] },
    });
  } finally {
    store.close();
  }
})();

function fakeLoop(name: string, status: LoopStatus, index: number): Loop {
  return {
    ...loopTemplate,
    id: `loop-${name}`,
    name,
    status,
    nextRunAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  };
}

interface FakeHostedStore extends Partial<LoopStore> {
  listLoopsCalls: Array<{ status?: LoopStatus; limit?: number; offset?: number }>;
}

function fakeHostedStore(counts: Partial<Record<LoopStatus, number>>): FakeHostedStore {
  const all: Loop[] = [];
  for (const status of STATUS_ORDER) {
    for (let i = 0; i < (counts[status] ?? 0); i += 1) {
      all.push(fakeLoop(`${status}-${i}`, status, all.length));
    }
  }
  const calls: Array<{ status?: LoopStatus; limit?: number; offset?: number }> = [];
  const store: FakeHostedStore = {
    listLoopsCalls: calls,
    async listLoops(opts: { status?: LoopStatus; limit?: number; offset?: number } = {}) {
      calls.push({ status: opts.status, limit: opts.limit, offset: opts.offset });
      const limit = Math.min(opts.limit ?? 200, SERVER_MAX_PAGE_LIMIT);
      const offset = opts.offset ?? 0;
      return all
        .filter((loop) => (opts.status ? loop.status === opts.status : true))
        .slice(offset, offset + limit);
    },
    async countLoops(status?: LoopStatus) {
      return all.filter((loop) => (status ? loop.status === status : true)).length;
    },
    async listRuns(): Promise<LoopRun[]> {
      return [];
    },
    async close() {},
  };
  return store;
}

describe("hosted loops health population coverage", () => {
  test("pages the eligible set to exhaustion instead of reading one window", async () => {
    const store = fakeHostedStore({ active: 60, expired: 30, paused: 450, stopped: 900 });

    const hosted = await buildHostedHealthReport(store as unknown as LoopStore);

    // 510 eligible loops across a 200-row page size: a single unpaged call
    // returned 200 and called it the fleet.
    expect(hosted.report.summary.loops).toBe(510);
    expect(hosted.report.summary.eligible).toBe(510);
    expect(hosted.report.summary.truncated).toBe(false);
    expect(hosted.report.expectations.filter((entry) => entry.loop.status === "active")).toHaveLength(60);
    expect(hosted.report.expectations.filter((entry) => entry.loop.status === "paused")).toHaveLength(450);
    expect(hosted.report.expectations.some((entry) => entry.loop.status === "stopped")).toBe(false);
  });

  test("asks the server for each eligible status rather than relying on row order", async () => {
    const store = fakeHostedStore({ active: 60, expired: 30, paused: 450, stopped: 900 });

    await buildHostedHealthReport(store as unknown as LoopStore);

    const statusesRequested = new Set(store.listLoopsCalls.map((call) => call.status));
    for (const status of HEALTH_ELIGIBLE_STATUSES) expect(statusesRequested.has(status)).toBe(true);
    // Server-side filtering is what makes ordering irrelevant: no unfiltered
    // page may be requested, or an ineligible loop can occupy a slot again.
    expect(store.listLoopsCalls.every((call) => call.status !== undefined)).toBe(true);
    expect(store.listLoopsCalls.some((call) => (call.offset ?? 0) > 0)).toBe(true);
    // Never paper over the window by asking for more than the server will give.
    expect(store.listLoopsCalls.every((call) => (call.limit ?? 0) <= SERVER_MAX_PAGE_LIMIT)).toBe(true);
  });

  test("coverage does not depend on active loops sorting first", async () => {
    // The same fleet with enough expired loops to fill the old 200-row window
    // twice over. Under the old single-call read the report would have contained
    // zero active loops while reporting a clean, sub-cap summary.
    const store = fakeHostedStore({ active: 60, expired: 500, paused: 450 });

    const hosted = await buildHostedHealthReport(store as unknown as LoopStore);

    expect(hosted.report.expectations.filter((entry) => entry.loop.status === "active")).toHaveLength(60);
    expect(hosted.report.summary.loops).toBe(510);
  });

  test("an explicit --limit is disclosed as truncation, not reported as a complete fleet", async () => {
    const store = fakeHostedStore({ active: 60, paused: 450 });

    const hosted = await buildHostedHealthReport(store as unknown as LoopStore, { limit: 100 });

    expect(hosted.report.summary.loops).toBe(100);
    expect(hosted.report.summary.eligible).toBe(510);
    expect(hosted.report.summary.truncated).toBe(true);
    // Runs are fetched per loop, so the bound must also bound that work: 100
    // reported loops means 100 run fetches, not 510.
    const population = hosted.unchecked.find((item) => item.id === "loop-population");
    expect(population!.reason).toContain("510");
    expect(population!.reason).toContain("100");
  });

  test("the unchecked disclosure names the population bound as its own item", async () => {
    const store = fakeHostedStore({ active: 5, paused: 5 });

    const hosted = await buildHostedHealthReport(store as unknown as LoopStore);

    // The bound used to be a subclause of `run-history-depth`, a sentence about
    // run history. A population bound that is only findable inside an unrelated
    // item is not a disclosure.
    const population = hosted.unchecked.find((item) => item.id === "loop-population");
    expect(population).toBeDefined();
    expect(population!.reason).toContain("10");
  });
});
