import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkgDir = join(import.meta.dir, "..", "..");
const pkgVersion = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version as string;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "src/cli/index.ts", ...args], {
    cwd: pkgDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe("workflows CLI (slice 1 scaffold)", () => {
  test("--version answers before anything else and exits 0", async () => {
    const r = await runCli(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(pkgVersion);
  });

  test("--help prints usage and exits 0", async () => {
    const r = await runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage");
    expect(r.stdout).toContain("workflows");
  });

  test("`version` command prints the package version", async () => {
    const r = await runCli(["version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(pkgVersion);
  });

  test("`health --json` prints a health report", async () => {
    const r = await runCli(["health", "--json"]);
    expect(r.exitCode).toBe(0);
    const h = JSON.parse(r.stdout) as { ok: boolean; service: string; version: string };
    expect(h.ok).toBe(true);
    expect(h.service).toBe("workflows");
    expect(h.version).toBe(pkgVersion);
  });

  test("`info` prints configuration without any credential value", async () => {
    const r = await runCli(["info"]);
    expect(r.exitCode).toBe(0);
    const info = JSON.parse(r.stdout) as { name: string; version: string; apiKey: unknown };
    expect(info.name).toBe("workflows");
    expect(info.version).toBe(pkgVersion);
    expect("apiKey" in info).toBe(false);
  });

  test("an unknown command exits non-zero", async () => {
    const r = await runCli(["definitely-not-a-command"]);
    expect(r.exitCode).not.toBe(0);
  });
});
