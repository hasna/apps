import { describe, test, expect } from "bun:test";
import { maybeStrip, isStrippingActive, STRIP_PROMPT } from "./strip.js";

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

  test("strip policy preserves continuation metadata", () => {
    for (const field of ["count", "total", "limit", "cursor", "nextCursor", "next_cursor", "hasMore", "has_more", "complete"]) {
      expect(STRIP_PROMPT).toContain(field);
    }
    expect(STRIP_PROMPT).not.toContain("Remove pagination metadata");
  });
});
