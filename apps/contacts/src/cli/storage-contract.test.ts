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
    expect(storageSource).toContain(".command(\"push\")");
    expect(storageSource).toContain(".command(\"pull\")");
    expect(storageSource).toContain(".command(\"feedback\")");
    for (const term of forbidden) {
      expect(cliSource).not.toContain(term);
      expect(storageSource).not.toContain(term);
    }
  });
});
