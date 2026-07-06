import { describe, expect, it } from "bun:test";
import { runSmoke } from "../src/release/package-smoke.js";

describe("package smoke script", () => {
  it("exercises the triad over an in-memory store", async () => {
    const result = await runSmoke();
    expect(result.ok).toBe(true);
    expect(result.cash_in_base_minor).toBe(100_00);
    expect(result.mcp_built).toBe(true);
    expect(result.serve_built).toBe(true);
    expect(result.openapi_paths).toBeGreaterThan(10);
  });
});
