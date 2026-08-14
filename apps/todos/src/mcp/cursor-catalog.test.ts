import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

describe("Cursor MCP catalog", () => {
  test("publishes the todos stdio server to project Cursor sessions", () => {
    const cursorConfig = JSON.parse(
      readFileSync(join(root, ".cursor", "mcp.json"), "utf-8"),
    ) as {
      mcpServers?: Record<string, {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
      }>;
    };
    const packageJson = JSON.parse(
      readFileSync(join(root, "package.json"), "utf-8"),
    ) as { bin?: Record<string, string> };

    expect(cursorConfig.mcpServers?.todos).toEqual({
      command: "todos-mcp",
      args: ["--stdio"],
      env: { TODOS_PROFILE: "minimal" },
    });
    expect(packageJson.bin?.["todos-mcp"]).toBe("dist/mcp/index.js");
  });
});
