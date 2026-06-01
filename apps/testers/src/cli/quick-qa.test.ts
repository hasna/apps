import { describe, expect, test } from "bun:test";
import { spawnSync } from "bun";

describe("testers quick-qa CLI", () => {
  test("documents the quick QA orchestration flags", () => {
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "quick-qa", "--help"],
      env: { ...process.env, TESTERS_DB_PATH: ":memory:" },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const stdout = proc.stdout.toString();
    expect(stdout).toContain("Usage: testers quick-qa|quick-check [options] <url>");
    expect(stdout).toContain("--skip <check>");
    expect(stdout).toContain("--a11y [level]");
    expect(stdout).toContain("--no-smoke");
    expect(stdout).toContain("--output <file>");
  });
});
