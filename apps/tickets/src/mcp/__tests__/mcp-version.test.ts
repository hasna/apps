import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getPackageVersion } from "../../lib/package-info.ts";

/**
 * Regression tests for the binds-before-help class (todos row 5fcf7a67).
 *
 * tickets-mcp --version/--help previously fell through to main()'s transport
 * resolution, entered MCP stdio mode, printed nothing, and exited rc=0
 * silently when stdin closed. Same defect class as styles-mcp (row 0d02f8b9,
 * PR 844), calendar-mcp (row 06003b88, PR 838), and secrets-mcp (row
 * afd9e358, PR 1016).
 *
 * The probes assert the exact contract: --version prints the package version
 * and --help prints usage, both rc=0, with no MCP protocol traffic and no
 * stdio transport wait. The negative probe asserts the real transport path is
 * still taken when no early arg is present.
 */

const TICKETS_ROOT = join(import.meta.dir, "../../..");

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
    cwd: TICKETS_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so a stdio server cannot wait on it
  const stdoutPromise = readStream(proc.stdout);
  const stderrPromise = readStream(proc.stderr);
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, 10_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, exitCode: proc.exitCode, timedOut };
}

describe("tickets-mcp answers --version/--help without entering stdio (row 5fcf7a67)", () => {
  test("--version prints the package version and exits", async () => {
    const result = await runMcp(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("-V prints the package version and exits", async () => {
    const result = await runMcp(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("--help prints usage and exits", async () => {
    const result = await runMcp(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("tickets-mcp");
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("plain mcp (no early args) still reaches the transport path (negative probe)", async () => {
    // No early arg: the stdio transport path must still be reached — with
    // stdin closed it ends the transport and exits rc=0, printing neither
    // the version nor usage. A fix that swallowed or skipped the start path
    // would regress this side.
    const result = await runMcp([]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain(getPackageVersion());
    expect(result.stdout).not.toContain("Usage:");
  });
});
