import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("contacts CLI connection contract", () => {
  it("registers one value-free HTTPS status command without storage selectors", () => {
    const cliSource = readFileSync(join(import.meta.dir, "index.tsx"), "utf8");
    const storageSource = readFileSync(join(import.meta.dir, "storage.ts"), "utf8");
    const forbidden = [
      "register" + "CloudCommands",
      "@hasna/" + "cloud",
      "cloud" + "-mcp",
    ];

    expect(cliSource).toContain("registerStorageCommands(program)");
    expect(storageSource).toContain(".command(\"connection\")");
    expect(storageSource).not.toContain(".command(\"storage\")");
    expect(storageSource).not.toContain(".command(\"cloud\")");
    expect(storageSource).not.toContain(".command(\"feedback\")");

    // Read-only status + feedback only. The forbidden client-side Postgres-DSN
    // sync commands (push/pull/sync) must NOT exist — clients never hold the raw
    // RDS DSN; cloud reads/writes flow through the ApiStore (HTTPS /v1 + bearer).
    expect(storageSource).not.toContain(".command(\"push\")");
    expect(storageSource).not.toContain(".command(\"pull\")");
    expect(storageSource).not.toContain(".command(\"sync\")");

    // Status is value-free and must never initialize a store or local database.
    expect(storageSource).not.toContain("getStore");
    expect(storageSource).not.toContain("../db/");
    expect(storageSource).not.toContain("getDatabase");
    expect(storageSource).toContain("local_fallback: false");

    for (const term of forbidden) {
      expect(cliSource).not.toContain(term);
      expect(storageSource).not.toContain(term);
    }
  });
});
