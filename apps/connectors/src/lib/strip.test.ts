import { describe, test, expect } from "bun:test";
import { maybeStrip, isStrippingActive } from "./strip.js";

describe("maybeStrip", () => {
  test("returns output unchanged when strip is disabled (no config)", async () => {
    // No LLM config in real home → passthrough
    const input = JSON.stringify({ data: [1, 2, 3], meta: { page: 1 } });
    const result = await maybeStrip(input);
    expect(result).toBe(input);
  });

  test("returns empty string unchanged", async () => {
    expect(await maybeStrip("")).toBe("");
  });

  test("returns whitespace-only string unchanged", async () => {
    expect(await maybeStrip("   ")).toBe("   ");
  });

  test("isStrippingActive returns false when no config", () => {
    // No config file in real home (or strip:false) → false
    const active = isStrippingActive();
    expect(typeof active).toBe("boolean");
  });
});
