import { describe, expect, test } from "bun:test";
import { isDirectMcpEntry } from "./index.js";

describe("MCP direct-run detection", () => {
  test("runs only for the dedicated MCP entrypoint", () => {
    expect(isDirectMcpEntry("/app/src/mcp/index.ts")).toBe(true);
    expect(isDirectMcpEntry("C:\\app\\dist\\mcp\\index.js")).toBe(true);
    expect(isDirectMcpEntry("/app/dist/server/index.js")).toBe(false);
    expect(isDirectMcpEntry(undefined)).toBe(false);
  });
});
