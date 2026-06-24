import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runCli(args: string[]): CliResult {
  const dir = mkdtempSync(join(tmpdir(), "open-security-storage-cli-"));
  const proc = Bun.spawnSync(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: dir,
      SECURITY_DB: join(dir, "shield.db"),
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("storage CLI contract", () => {
  test("exposes storage command and has no cloud alias in help", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("storage");
    expect(result.stdout).toContain("Manage shield local/remote storage sync");
    expect(result.stdout).not.toContain("cloud");
  });

  test("does not keep a hidden cloud command alias", () => {
    const source = readFileSync(join(process.cwd(), "src/cli/commands/storage.ts"), "utf8");
    const retiredAlias = ["cl", "oud"].join("");

    expect(source).toContain("export function registerStorageCommands");
    expect(source).toContain('program.command("storage")');
    expect(source).not.toContain(`program.command("${retiredAlias}"`);
  });
});
