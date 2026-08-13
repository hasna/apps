import { describe, expect, test } from "bun:test";
import { gatherFromEconomy } from "./economy.js";

describe("gatherFromEconomy", () => {
  test("returns empty result when @hasna/economy is not installed", async () => {
    // @hasna/economy is not installed in this project
    const result = await gatherFromEconomy();
    expect(result.source).toBe("economy");
    expect(Array.isArray(result.examples)).toBe(true);
  });

  test("respects limit option", async () => {
    const result = await gatherFromEconomy({ limit: 5 });
    expect(result.examples.length).toBeLessThanOrEqual(5);
  });

  test("returns GatherResult shape", async () => {
    const result = await gatherFromEconomy();
    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("examples");
    expect(result).toHaveProperty("count");
  });
});
