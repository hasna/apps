import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("storage MCP contract", () => {
  test("registers storage tools instead of cloud-named public tools", () => {
    const toolsSource = readFileSync(join(process.cwd(), "src/mcp/storage-tools.ts"), "utf8");
    const indexSource = readFileSync(join(process.cwd(), "src/mcp/index.ts"), "utf8");

    expect(toolsSource).toContain("export const BRAINS_STORAGE_TOOLS");
    expect(indexSource).toContain("BRAINS_STORAGE_TOOLS");
    expect(indexSource).toContain("handleBrainsStorageTool");
    expect(toolsSource).toContain('"brains_storage_status"');
    expect(toolsSource).toContain('"brains_storage_push"');
    expect(toolsSource).toContain('"brains_storage_pull"');
    expect(toolsSource).toContain('"brains_storage_sync"');
    expect(toolsSource).not.toContain(`"brains_${["cloud"].join("")}_`);
    expect(indexSource).not.toContain(["BRAINS", "CLOUD", "TOOLS"].join("_"));
    expect(indexSource).not.toContain(["handleBrains", "Cloud", "Tool"].join(""));
  });
});
