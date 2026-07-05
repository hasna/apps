import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const retiredTool = (action: string) => ["\"", "conversations", "_cloud_", action, "\""].join("");
const retiredRegisterExport = ["register", "Cloud", "SyncTools"].join("");

describe("conversations storage MCP contract", () => {
  it("registers storage tools instead of cloud tools", () => {
    const toolsSource = readFileSync(join(import.meta.dir, "storage.ts"), "utf8");
    const indexSource = readFileSync(join(import.meta.dir, "../index.ts"), "utf8");

    expect(indexSource).toContain("registerStorageSyncTools");
    expect(toolsSource).toContain('"conversations_storage_status"');
    expect(toolsSource).toContain('"conversations_storage_push"');
    expect(toolsSource).toContain('"conversations_storage_pull"');
    expect(toolsSource).toContain('"conversations_storage_sync"');
    expect(toolsSource).toContain('"conversations_storage_migrate"');
    expect(toolsSource).toContain('"conversations_storage_feedback"');
    expect(toolsSource).toContain('"conversations_storage_readiness"');
    expect(toolsSource.match(/await runStorageMigrations\(pg\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(toolsSource).not.toContain(retiredTool("status"));
    expect(toolsSource).not.toContain(retiredTool("push"));
    expect(toolsSource).not.toContain(retiredTool("pull"));
    expect(toolsSource).not.toContain(retiredTool("sync"));
    expect(toolsSource).not.toContain(retiredTool("migrate"));
    expect(toolsSource).not.toContain(retiredTool("feedback"));
    expect(toolsSource).not.toContain(retiredRegisterExport);
  });
});
