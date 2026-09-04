import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildServer } from "./index.js";

describe("contacts MCP connection contract", () => {
  it("registers one value-free HTTPS status tool without storage selectors", () => {
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

    expect(registeredTools).toContain("contacts_connection_status");
    expect(registeredTools).not.toContain("contacts_storage_status");
    expect(registeredTools).not.toContain("contacts_cloud_status");
    expect(registeredTools).not.toContain("contacts_cloud_feedback");
    for (const removed of [
      "contacts_storage_push",
      "contacts_storage_pull",
      "contacts_storage_sync",
      "contacts_cloud_push",
      "contacts_cloud_pull",
      "contacts_cloud_sync",
    ]) {
      expect(registeredTools).not.toContain(removed);
    }
    for (const term of forbidden) {
      expect(mcpSource).not.toContain(term);
      expect(storageSource).not.toContain(term);
    }

    // Status is value-free and must never initialize a store or local database.
    expect(storageSource).not.toContain("getStore");
    expect(storageSource).not.toContain("../db/");
    expect(storageSource).not.toContain("getDatabase");
    expect(storageSource).toContain("local_fallback: false");
  });
});
