import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const rootDir = join(import.meta.dir, "..");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `secrets-scan-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function runScan(args: string[], input?: string): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [join(rootDir, "src/index.ts"), "scan", ...args], {
    cwd: testDir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    input,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("scan CLI fail-closed behavior", () => {
  it("keeps a valid directory workspace scan successful", () => {
    writeFileSync(join(testDir, "clean.txt"), "ordinary non-secret content\n");

    const result = runScan(["workspace", ".", "--json"]);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.source).toBe("workspace");
    expect(parsed.stats.filesScanned).toBe(1);
    expect(parsed.stats.errors).toEqual([]);
    expect(parsed.findingCount).toBe(0);
  });

  it("rejects unsupported scan stdin flags instead of scanning the workspace", () => {
    writeFileSync(join(testDir, "workspace.txt"), "ordinary non-secret content\n");

    const result = runScan(["--stdin", "--format", "json", "--redact"], "stdin-only content\n");

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unsupported option for secrets scan: --stdin");
    expect(result.stdout).toBe("");
  });

  it("fails when a workspace root is a regular file", () => {
    writeFileSync(join(testDir, "regular-file.txt"), "ordinary non-secret content\n");

    const result = runScan(["workspace", "regular-file.txt", "--json"]);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(parsed.source).toBe("workspace");
    expect(parsed.stats.filesScanned).toBe(0);
    expect(parsed.stats.errors.length).toBeGreaterThan(0);
  });
});
