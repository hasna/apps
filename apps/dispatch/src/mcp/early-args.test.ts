import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getPackageVersion } from "../lib/version.js";

/**
 * Regression tests for the binds-before-version class (todos row 8a43ca44).
 *
 * dispatch-mcp --version/--help previously fell through to main(): the entry
 * built the MCP server and awaited StdioServerTransport.connect with no argv
 * classification, so --version entered MCP stdio mode, printed nothing, and
 * exited rc=0 silently when stdin closed. Same defect class as tickets-mcp
 * (row 5fcf7a67, PR 848), styles-mcp (row 0d02f8b9, PR 844) and
 * calendar-mcp (row 06003b88, PR 838).
 *
 * The probes are two-sided: --help/--version must answer rc=0 WITHOUT
 * entering the stdio loop, with no MCP protocol traffic (positive), and a
 * plain run must STILL take the stdio MCP server path — it stays alive
 * reading stdin and does not exit (negative).
 */

const PACKAGE_ROOT = join(import.meta.dir, "..", "..");
const MCP_ENTRY = "src/mcp/index.ts";

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runMcp(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "run", MCP_ENTRY, ...args], {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so a stdio server cannot wait on it
  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("dispatch-mcp answers --version/--help before entering MCP stdio mode", () => {
  test("--version prints the package version and exits rc=0 without entering the stdio loop", async () => {
    const result = await runMcp(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("-V prints the package version and exits rc=0", async () => {
    const result = await runMcp(["-V"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("--help prints usage and exits rc=0 without entering the stdio loop", async () => {
    const result = await runMcp(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("dispatch-mcp");
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test(
    "plain run (no early args) still takes the stdio MCP server path and stays alive on stdin (negative probe)",
    async () => {
      // The real stdio path must be unchanged by the early-args fix: with no
      // --help/--version, the entry still builds the server and connects to
      // the stdio transport, which reads stdin for JSON-RPC and does not
      // exit. stdin is an open, silent pipe, so a regression that swallowed
      // the stdio path (or made plain runs exit immediately) would fail this
      // probe.
      const proc = Bun.spawn([process.execPath, "run", MCP_ENTRY], {
        cwd: PACKAGE_ROOT,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      });
      const timedOut = await Promise.race([
        proc.exited.then(() => false),
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            proc.kill();
            resolve(true);
          }, 10_000);
        }),
      ]);
      await proc.exited;
      expect(timedOut).toBe(true);
    },
    15_000,
  );
});
