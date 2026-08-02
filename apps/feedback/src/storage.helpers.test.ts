import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyFeedbackFilter, buildFeedbackSearchHaystack, computeFeedbackStats, LocalFeedbackStore } from "./storage.js";
import type { FeedbackItem } from "./types.js";

/**
 * These helpers exist so that a store implementor backed by something other
 * than the bundled JSONL file — Postgres, SQLite, an in-memory fake — can reuse
 * the SDK's filter/search/stats semantics instead of reimplementing them.
 *
 * Two shipped consumers (platform-mailery and platform-alumia) each hand-copied
 * private versions of these functions and left a comment saying they only did so
 * because the SDK did not export them. The copies were byte-identical when
 * measured, which is the point: parity was being held by hand, and nothing would
 * have failed if it slipped. The assertions below are therefore written as
 * PARITY assertions against LocalFeedbackStore rather than as restatements of
 * the helpers' internals — a test that merely re-encoded the same logic would
 * pass in exactly the case that matters least.
 */

async function tempStore(): Promise<LocalFeedbackStore> {
  const dataDir = await mkdtemp(join(tmpdir(), "open-feedback-helpers-"));
  return new LocalFeedbackStore({ dataDir });
}

describe("exported read-side helpers", () => {
  test("are exported as callable functions", () => {
    expect(typeof applyFeedbackFilter).toBe("function");
    expect(typeof buildFeedbackSearchHaystack).toBe("function");
    expect(typeof computeFeedbackStats).toBe("function");
  });

  test("applyFeedbackFilter matches LocalFeedbackStore.listFeedback", async () => {
    const store = await tempStore();
    await store.createFeedback({ appId: "app-a", message: "billing export needs CSV", kind: "bug", tags: ["Reports"] });
    await store.createFeedback({ appId: "app-b", message: "dark mode please", kind: "idea" });
    await store.createFeedback({ appId: "app-a", message: "crash on login", kind: "bug", severity: "high" });

    const all = await store.listFeedback({ limit: 500 });

    for (const filter of [
      {},
      { appId: "app-a" },
      { kind: "bug" as const },
      { tag: "reports" },
      { search: "CSV" },
      { search: "nothing-matches-this" },
      { limit: 1 },
      { status: "new" as const },
    ]) {
      expect(applyFeedbackFilter(all, filter)).toEqual(await store.listFeedback(filter));
    }
  });

  test("applyFeedbackFilter clamps limit and sorts newest first, like the store", async () => {
    const store = await tempStore();
    for (let i = 0; i < 4; i += 1) {
      await store.createFeedback(
        { appId: "app-a", message: `item ${i}` },
        { now: new Date(`2026-01-0${i + 1}T00:00:00.000Z`) },
      );
    }
    const all = await store.listFeedback({ limit: 500 });

    // newest-first ordering
    expect(applyFeedbackFilter(all, {}).map((i) => i.message)).toEqual(["item 3", "item 2", "item 1", "item 0"]);
    // limit floor: 0 and negatives clamp up to 1, never to "everything"
    expect(applyFeedbackFilter(all, { limit: 0 })).toHaveLength(1);
    expect(applyFeedbackFilter(all, { limit: -5 })).toHaveLength(1);
    // limit ceiling: 500 max
    expect(applyFeedbackFilter(all, { limit: 10_000 })).toHaveLength(4);
  });

  test("computeFeedbackStats matches LocalFeedbackStore.stats", async () => {
    const store = await tempStore();
    await store.createFeedback({ appId: "app-a", message: "one", kind: "bug", severity: "high" });
    await store.createFeedback({ appId: "app-b", message: "two", kind: "idea" });
    await store.createFeedback({ appId: "app-a", message: "three", kind: "bug" });

    const all = await store.listFeedback({ limit: 500 });
    expect(computeFeedbackStats(all)).toEqual(await store.stats());
  });

  test("computeFeedbackStats zero-fills every kind and status on an empty input", () => {
    const stats = computeFeedbackStats([]);
    expect(stats.total).toBe(0);
    expect(stats.byApp).toEqual({});
    expect(stats.bySeverity).toEqual({});
    // every enum member present as an explicit 0 rather than absent
    expect(Object.values(stats.byKind).every((n) => n === 0)).toBe(true);
    expect(Object.values(stats.byStatus).every((n) => n === 0)).toBe(true);
    expect(Object.keys(stats.byKind).length).toBeGreaterThan(0);
    expect(Object.keys(stats.byStatus).length).toBeGreaterThan(0);
  });

  test("buildFeedbackSearchHaystack is lowercased and spans the searchable fields", async () => {
    const store = await tempStore();
    const item: FeedbackItem = await store.createFeedback({
      appId: "app-a",
      message: "Billing EXPORT",
      kind: "bug",
      severity: "high",
      tags: ["Reports"],
      url: "https://example.test/BILLING",
      context: { route: "/billing" },
    });

    const haystack = buildFeedbackSearchHaystack(item);
    expect(haystack).toBe(haystack.toLowerCase());
    for (const needle of ["app-a", "billing export", "bug", "high", "reports", "/billing"]) {
      expect(haystack).toContain(needle);
    }
  });

  test("buildFeedbackSearchHaystack backs the store's own search filter", async () => {
    const store = await tempStore();
    await store.createFeedback({ appId: "app-a", message: "unrelated" });
    await store.createFeedback({ appId: "app-a", message: "needle in here", tags: ["haystack"] });

    const all = await store.listFeedback({ limit: 500 });
    const matching = all.filter((item) => buildFeedbackSearchHaystack(item).includes("needle"));
    expect(matching).toEqual(await store.listFeedback({ search: "needle" }));
    expect(matching).toHaveLength(1);
  });
});
