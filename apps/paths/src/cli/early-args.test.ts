import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { PATHS_VERSION } from "../version.js";

/**
 * Regression tests for the binds-before-version class (T-00101 pattern; found
 * on @hasna/paths by the codewith release review of 0.2.0, 2026-08-26).
 *
 * paths --help previously exited 2 because the required-argument validation
 * ("--app <slug> is required") ran inside parseArgs before the help branch in
 * main(); paths --version exited 2 as an unknown argument. Both control
 * surfaces must answer rc=0 before any argument validation.
 *
 * The probes are two-sided: --version/--help must answer rc=0 with version or
 * usage on stdout (positive), and plain `paths` with no args must STILL exit
 * 2 with the required-arg error — a fix that swallowed validation would
 * regress this side.
 */

const PATHS_ROOT = join(import.meta.dir, "../..");

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.ts", ...args], {
    cwd: PATHS_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end();
  const stdoutPromise = readStream(proc.stdout);
  const stderrPromise = readStream(proc.stderr);
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, 4_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, exitCode: proc.exitCode, timedOut };
}

describe("paths answers --version/--help before any validation", () => {
  test("--version prints the package version and exits 0", async () => {
    const result = await runCli(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PATHS_VERSION);
  });

  test("-V prints the package version and exits 0", async () => {
    const result = await runCli(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PATHS_VERSION);
  });

  test("--help prints usage and exits 0 (was exit 2: required-arg validation ran first)", async () => {
    const result = await runCli(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--version");
  });

  test("-h prints usage and exits 0", async () => {
    const result = await runCli(["-h"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  test("plain paths with no args still exits 2 with the required-arg error (negative probe)", async () => {
    const result = await runCli([]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--app <slug> is required");
    expect(result.stdout).not.toContain(PATHS_VERSION);
  });
});
