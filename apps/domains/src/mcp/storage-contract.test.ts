import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("domains storage MCP contract", () => {
  it("registers storage tools", () => {
    const toolsSource = readFileSync(join(import.meta.dir, "storage-tools.ts"), "utf8");
    const indexSource = readFileSync(join(import.meta.dir, "index.ts"), "utf8");

    expect(indexSource).toContain("registerDomainsStorageTools");
    expect(toolsSource).toContain('"storage_status"');
    expect(toolsSource).toContain('"storage_push"');
    expect(toolsSource).toContain('"storage_pull"');
    expect(toolsSource).toContain('"storage_sync"');
  });
});
