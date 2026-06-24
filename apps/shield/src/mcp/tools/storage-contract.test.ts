import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("storage MCP contract", () => {
  test("registers storage tools instead of cloud-named public tools", () => {
    const toolsSource = readFileSync(join(process.cwd(), "src/mcp/tools/storage.ts"), "utf8");
    const buildServerSource = readFileSync(join(process.cwd(), "src/mcp/build-server.ts"), "utf8");
    const retiredToolPrefix = ["shield", "cloud"].join("_");
    const retiredRegistrar = ["registerShield", "Cloud", "Tools"].join("");

    expect(toolsSource).toContain("export function registerShieldStorageTools");
    expect(buildServerSource).toContain("registerShieldStorageTools(server)");
    expect(toolsSource).toContain('"shield_storage_status"');
    expect(toolsSource).toContain('"shield_storage_push"');
    expect(toolsSource).toContain('"shield_storage_pull"');
    expect(toolsSource).toContain('"shield_storage_sync"');
    expect(toolsSource).toContain('"shield_storage_feedback"');
    expect(toolsSource).not.toContain(`"${retiredToolPrefix}_`);
    expect(buildServerSource).not.toContain(`${retiredRegistrar}(server)`);
  });
});
