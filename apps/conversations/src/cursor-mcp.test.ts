import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("Cursor MCP catalog", () => {
  test("registers the conversations MCP server", () => {
    const catalog = JSON.parse(
      readFileSync(join(import.meta.dir, "..", ".cursor", "mcp.json"), "utf8"),
    );

    expect(catalog).toEqual({
      mcpServers: {
        conversations: {
          command: "conversations-mcp",
        },
      },
    });
  });
});
