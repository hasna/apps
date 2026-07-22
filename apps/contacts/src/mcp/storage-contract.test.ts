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

    // Read-only status + feedback only. The forbidden client-side Postgres-DSN
    // sync tools (push/pull/sync) must NOT be registered.
    expect(registeredTools).toContain("contacts_storage_status");
    expect(registeredTools).toContain("contacts_cloud_status");
    expect(registeredTools).toContain("contacts_cloud_feedback");
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

    // The storage tools must route through the single Store — never the db/*
    // layer or raw SQLite directly (the split-brain bug this rebuild eliminates).
    expect(storageSource).toContain("getStore");
    expect(storageSource).not.toContain("../db/");
    expect(storageSource).not.toContain("getDatabase");
  });
});
