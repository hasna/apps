import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempHome = "";
let dbPath = "";

function runCli(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", "--db", dbPath, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tempHome,
      SHORTLINKS_HOME: tempHome,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "shortlinks-storage-cli-"));
  dbPath = join(tempHome, "shortlinks.db");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe("storage CLI contract", () => {
  test("exposes storage command and remote flag", () => {
    const result = runCli(["--help"]);
    const help = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(help).toContain("storage");
    expect(help).toContain("--remote");
    expect(help).toContain("Local/remote storage sync helpers");
  });

  test("does not accept the old migration command", () => {
    const result = runCli(["cloud", "status", "--json"]);

    expect(result.exitCode).not.toBe(0);
  });

  test("storage status includes canonical RDS metadata", () => {
    const result = runCli(["storage", "status", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    const status = JSON.parse(result.stdout.toString());
    expect(status.canonical).toEqual({
      cluster: "postgres-compatible-database",
      database: "shortlinks",
      runtimeSecretPath: "configured-by-environment",
      primaryEnv: "HASNA_SHORTLINKS_DATABASE_URL",
      fallbackEnv: "SHORTLINKS_DATABASE_URL",
    });
  });
});
