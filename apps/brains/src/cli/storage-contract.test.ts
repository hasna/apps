import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function runCli(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "brains-storage-cli-"));
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: dir,
      HASNA_BRAINS_DB_PATH: ":memory:",
      BRAINS_DB_PATH: ":memory:",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("storage CLI contract", () => {
  test("exposes storage command and hides deprecated cloud alias from help", () => {
    const result = runCli(["--help"]);
    const help = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(help).toContain("storage");
    expect(help).toContain("Manage brains local/remote storage sync");
    expect(help).not.toContain("cloud");
  });

  test("registers only storage commands", () => {
    const source = readFileSync(join(process.cwd(), "src/cli/commands/storage.ts"), "utf8");

    expect(source).toContain("export function registerStorageCommands");
    expect(source).toContain('program.command("storage")');
    expect(source).not.toContain('program.command("cloud"');
    expect(source).not.toContain(["register", "Cloud", "Commands"].join(""));
  });
});
