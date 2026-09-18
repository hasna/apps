import { describe, expect, test } from "bun:test";
import { normalizeMcpAuditLimit } from "../src/mcp.js";

describe("Secrets MCP output compatibility", () => {
  test("full audit restores the legacy 50-row default", () => {
    expect(normalizeMcpAuditLimit(undefined, false)).toBe(20);
    expect(normalizeMcpAuditLimit(undefined, true)).toBe(50);
    expect(normalizeMcpAuditLimit(7, true)).toBe(7);
  });
});
