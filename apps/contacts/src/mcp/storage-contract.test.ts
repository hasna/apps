import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildServer } from "./index.js";

describe("contacts MCP storage contract", () => {
  it("registers contacts-owned storage tools without shared cloud tools", () => {
    const mcpSource = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
    const storageSource = readFileSync(join(import.meta.dir, "storage-tools.ts"), "utf8");
    const forbidden = [
      "register" + "CloudTools",
      "@hasna/" + "cloud",
      "cloud_tools",
      "cloud" + "-mcp",
    ];

    const server = buildServer();
    const registeredTools = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools
    );

    expect(registeredTools).toContain("contacts_storage_status");
    expect(registeredTools).toContain("contacts_storage_push");
    expect(registeredTools).toContain("contacts_storage_pull");
    expect(registeredTools).toContain("contacts_storage_sync");
    expect(registeredTools).toContain("contacts_cloud_status");
    expect(registeredTools).toContain("contacts_cloud_push");
    expect(registeredTools).toContain("contacts_cloud_pull");
    expect(registeredTools).toContain("contacts_cloud_sync");
    expect(registeredTools).toContain("contacts_cloud_feedback");
    for (const term of forbidden) {
      expect(mcpSource).not.toContain(term);
      expect(storageSource).not.toContain(term);
    }
  });
});
