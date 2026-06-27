import { describe, expect, test, beforeAll } from "bun:test";
import { gatherAll } from "./index.js";
import { registerGatherer } from "./registry.js";
import type { GatherResult } from "./types.js";

const mockExample = {
  messages: [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "hello" },
    { role: "assistant" as const, content: "hi" },
  ],
};

beforeAll(() => {
  registerGatherer({
    name: "__mock_a__",
    gather: async () => ({ source: "__mock_a__", examples: [mockExample], count: 1 }),
    description: "mock a",
  });
  registerGatherer({
    name: "__mock_b__",
    gather: async () => ({ source: "__mock_b__", examples: [], count: 0 }),
    description: "mock b",
  });
  registerGatherer({
    name: "__mock_err__",
    gather: async () => { throw new Error("gather failed"); },
    description: "mock that fails",
  });
});

describe("gatherAll", () => {
  test("gathers from specified sources", async () => {
    const results = await gatherAll(["__mock_a__", "__mock_b__"]);
    expect(results.length).toBe(2);
    const a = results.find((r) => r.source === "__mock_a__");
    expect(a?.count).toBe(1);
  });

  test("skips failed gatherers (allSettled)", async () => {
    const results = await gatherAll(["__mock_a__", "__mock_err__"]);
    // __mock_err__ throws, so only __mock_a__ is returned
    expect(results.some((r) => r.source === "__mock_a__")).toBe(true);
    expect(results.some((r) => r.source === "__mock_err__")).toBe(false);
  });

  test("returns empty result for unknown source (no registered fn)", async () => {
    const results = await gatherAll(["__not_registered__"]);
    expect(results.length).toBe(1);
    expect(results[0]?.count).toBe(0);
    expect(results[0]?.examples).toEqual([]);
  });

  test("'all' expands to all registered sources", async () => {
    const results = await gatherAll(["all"]);
    // Should include at least the mock sources we registered
    expect(results.length).toBeGreaterThan(0);
  });

  test("returns empty array for empty sources list", async () => {
    const results = await gatherAll([]);
    expect(results).toEqual([]);
  });
});
