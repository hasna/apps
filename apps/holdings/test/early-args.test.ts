import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { APP_VERSION } from "../src/version.js";

/**
 * Regression tests for the binds-before-version class (todos row 7e5f8f3d).
 *
 * holdings-mcp --help previously fell through main()'s --version guard into
 * the stdio transport and printed nothing (silent-empty family on help).
 * --help must answer rc=0 with usage before the transport; --version already
 * worked and stays guarded.
 *
 * The probes are two-sided: --help/--version must answer rc=0 (positive), and
 * plain holdings-mcp must STILL reach the transport path — with stdin closed
 * it ends, printing neither version nor usage (negative).
 */

const HOLDINGS_ROOT = join(import.meta.dir, "..");

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
    cwd: HOLDINGS_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so the stdio transport cannot wait on it
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

describe("holdings-mcp answers --help/--version before any transport (row 7e5f8f3d)", () => {
  test("--help prints usage and exits", async () => {
    const result = await runMcp(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("holdings-mcp");
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("-h prints usage and exits", async () => {
    const result = await runMcp(["-h"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("holdings-mcp");
  });

  test("--version prints the package version and exits (unchanged)", async () => {
    const result = await runMcp(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(APP_VERSION);
  });

  test("plain holdings-mcp still reaches the transport path (negative probe)", async () => {
    // No early arg: with stdin closed the transport ends, printing neither
    // version nor usage. A fix that swallowed the start path would regress
    // this side.
    const result = await runMcp([]);
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).not.toBe(APP_VERSION);
    expect(result.stdout).not.toContain("Usage:");
  });
});
