import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };

// Regression: T-00096 — the ui CLI bin had no -h/--help/-V/--version surface.
// Every flag fell through to the default branch, printed usage to stderr and
// exited 1, so an installed `ui -V` or `ui -h` was a broken CLI.

function runCli(...args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("ui CLI flag surface", () => {
  test("--help exits 0 and documents the commands", () => {
    const help = runCli("--help");
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("commands:");
    expect(help.stdout.toString()).toContain("fetch");
  });

  test("-h exits 0 and prints usage on stdout", () => {
    const help = runCli("-h");
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("commands:");
  });

  test("--version prints the package version and exits 0", () => {
    const version = runCli("--version");
    expect(version.exitCode).toBe(0);
    expect(version.stdout.toString().trim()).toBe(pkg.version);
  });

  test("-V exits 0 and prints a semver", () => {
    const version = runCli("-V");
    expect(version.exitCode).toBe(0);
    expect(version.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("an unknown command still exits 1 with usage on stderr", () => {
    const unknown = runCli("bogus-command");
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr.toString()).toContain("commands:");
  });
});
