import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("domains storage CLI contract", () => {
  it("keeps storage command out of default help", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "src/cli/index.ts", "--help"],
      cwd: join(import.meta.dir, "../../.."),
      env: {
        ...process.env,
        HASNA_DOMAINS_DB_PATH: ":memory:",
        NO_COLOR: "1",
      },
    });

    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).not.toContain("storage");
  });

  it("shows storage command when its optional group is enabled", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "src/cli/index.ts", "--help"],
      cwd: join(import.meta.dir, "../../.."),
      env: {
        ...process.env,
        DOMAINS_COMMAND_GROUPS: "storage",
        HASNA_DOMAINS_DB_PATH: ":memory:",
        NO_COLOR: "1",
      },
    });

    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("storage");
  });

  it("registers only the storage command", () => {
    const source = readFileSync(join(import.meta.dir, "storage.ts"), "utf8");

    expect(source).toContain("registerStorageCommand");
    expect(source).toContain('program.command("storage")');
    expect(source).not.toContain("hidden: true");
  });
});
