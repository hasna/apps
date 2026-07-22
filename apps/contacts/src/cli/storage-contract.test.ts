import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("contacts CLI storage contract", () => {
  it("registers contacts-owned storage commands without shared cloud commands", () => {
    const cliSource = readFileSync(join(import.meta.dir, "index.tsx"), "utf8");
    const storageSource = readFileSync(join(import.meta.dir, "storage.ts"), "utf8");
    const forbidden = [
      "register" + "CloudCommands",
      "@hasna/" + "cloud",
      "cloud" + "-mcp",
    ];

    expect(cliSource).toContain("registerStorageCommands(program)");
    expect(storageSource).toContain(".command(\"storage\")");
    expect(storageSource).toContain(".command(\"status\")");
    expect(storageSource).toContain(".command(\"cloud\")");
    expect(storageSource).toContain(".command(\"feedback\")");

    // Read-only status + feedback only. The forbidden client-side Postgres-DSN
    // sync commands (push/pull/sync) must NOT exist — clients never hold the raw
    // RDS DSN; cloud reads/writes flow through the ApiStore (HTTPS /v1 + bearer).
    expect(storageSource).not.toContain(".command(\"push\")");
    expect(storageSource).not.toContain(".command(\"pull\")");
    expect(storageSource).not.toContain(".command(\"sync\")");

    // The command layer must route through the single Store — never the db/*
    // layer or raw SQLite directly (the split-brain bug this rebuild eliminates).
    expect(storageSource).toContain("getStore");
    expect(storageSource).not.toContain("../db/");
    expect(storageSource).not.toContain("getDatabase");

    for (const term of forbidden) {
      expect(cliSource).not.toContain(term);
      expect(storageSource).not.toContain(term);
    }
  });
});
