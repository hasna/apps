import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

describe("Cursor MCP catalog", () => {
  test("does not ship a Cursor MCP auto-registration for the todos server", () => {
    // Fleet rule (hosted `global-fleet-credentials-no-mcp` v3.0.1, `global-no-mcp-use-clis`):
    // Hasna MCP servers are never registered in a coding agent. A checked-in
    // `.cursor/mcp.json` would auto-register `todos-mcp` for any Cursor session opened
    // in this package, so the package must not carry one. Third-party users wire the
    // server themselves (README) or via `todos mcp` registration commands.
    expect(existsSync(join(root, ".cursor", "mcp.json"))).toBe(false);
  });

  test("still publishes the todos stdio server bin for user-driven registration", () => {
    const packageJson = JSON.parse(
      readFileSync(join(root, "package.json"), "utf-8"),
    ) as { bin?: Record<string, string> };

    expect(packageJson.bin?.["todos-mcp"]).toBe("dist/mcp/index.js");
  });
});
