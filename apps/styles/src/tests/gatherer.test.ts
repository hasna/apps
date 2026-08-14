import { describe, expect, test } from "bun:test";
import { gatherTrainingData, type GatherResult } from "../lib/gatherer.js";

describe("gatherTrainingData", () => {
  test("returns GatherResult with correct source", async () => {
    const result = await gatherTrainingData({ limit: 10 });
    expect(result.source).toBe("styles");
    expect(Array.isArray(result.examples)).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(0);
    expect(result.count).toBeLessThanOrEqual(10);
  });

  test("parameters respected — limit", async () => {
    const result = await gatherTrainingData({ limit: 2 });
    expect(result.count).toBeLessThanOrEqual(2);
  });

  test("parameters respected — larger limit", async () => {
    const result = await gatherTrainingData({});
    // Default limit is 500, but actual count depends on available data
    expect(result.count).toBeLessThanOrEqual(500);
    expect(result.count).toBeGreaterThan(0);
  });

  test("each example has messages array with role + content", async () => {
    const result = await gatherTrainingData({ limit: 5 });
    for (const example of result.examples) {
      expect(Array.isArray(example.messages)).toBe(true);
      expect(example.messages.length).toBeGreaterThan(0);
      for (const msg of example.messages) {
        expect(["system", "user", "assistant"]).toContain(msg.role);
        expect(typeof msg.content).toBe("string");
        expect(msg.content.length).toBeGreaterThan(0);
      }
    }
  });

  test("returns examples with adequate limit", async () => {
    // Need at least 4 to get examples from built-in styles (limit/4 per category)
    const result = await gatherTrainingData({ limit: 16 });
    expect(result.count).toBeGreaterThanOrEqual(4);
    expect(result.count).toBeLessThanOrEqual(16);
  });
});
