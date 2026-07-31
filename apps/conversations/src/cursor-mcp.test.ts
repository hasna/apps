import { describe, expect, test } from "bun:test";
import cursorMcp from "../.cursor/mcp.json";
import pkg from "../package.json";

describe("Cursor MCP configuration", () => {
  test("registers the published conversations MCP binary", () => {
    expect(cursorMcp.mcpServers.conversations).toEqual({
      command: "conversations-mcp",
    });
    expect(pkg.bin["conversations-mcp"]).toBe("bin/mcp.js");
  });
});
