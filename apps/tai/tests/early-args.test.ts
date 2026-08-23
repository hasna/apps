import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { readPackageVersion } from "../src/version";

/**
 * Regression tests for the binds-before-version class (todos row 7e5f8f3d).
 *
 * tai-mcp --version/--help previously fell straight into the readline loop on
 * stdin and printed nothing (silent-empty family). Both must answer rc=0
 * before the readline transport is entered.
 *
 * The probes are two-sided: --version/--help must answer rc=0 with version or
 * usage on stdout (positive), and plain tai-mcp must STILL reach the readline
 * path — with stdin closed it ends, printing neither version nor usage
 * (negative).
 */

const TAI_ROOT = join(import.meta.dir, "..");

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

async function runMcp(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, "run", "src/mcp/index.ts", ...args], {
    cwd: TAI_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so the readline loop cannot wait on it
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

describe("tai-mcp answers --version/--help before any transport (row 7e5f8f3d)", () => {
  test("--version prints the package version and exits", async () => {
    const result = await runMcp(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(readPackageVersion());
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("-V prints the package version and exits", async () => {
    const result = await runMcp(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(readPackageVersion());
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("--help prints usage and exits", async () => {
    const result = await runMcp(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("tai-mcp");
  });

  test("plain tai-mcp still reaches the readline path (negative probe)", async () => {
    // No early arg: with stdin closed the readline loop ends, printing
    // neither version nor usage. A fix that swallowed the start path would
    // regress this side.
    const result = await runMcp([]);
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).not.toBe(readPackageVersion());
    expect(result.stdout).not.toContain("Usage:");
  });
});
