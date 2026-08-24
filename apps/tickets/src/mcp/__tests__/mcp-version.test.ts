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
 * still taken when no early arg is present — by driving an actual MCP
 * initialize round-trip over stdio, so an implementation that skipped the boot
 * path and exited 0 (which would emit no JSON-RPC response) fails the probe.
 */

const TICKETS_ROOT = join(import.meta.dir, "../../..");

/** A well-formed MCP `initialize` request, newline-delimited for the stdio transport. */
const INITIALIZE_REQUEST =
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "tickets-mcp-probe", version: "1.0.0" },
    },
  }) + "\n";

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

/**
 * Drives one MCP `initialize` round-trip over the stdio transport. Returns the
 * captured stdout, whether a JSON-RPC initialize response was observed, and
 * whether the process exited cleanly after stdin EOF.
 */
async function driveStdioInitialize(): Promise<RunResult & { gotInitializeResponse: boolean }> {
  const proc = Bun.spawn([process.execPath, "run", "src/mcp/index.ts"], {
    cwd: TICKETS_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.write(INITIALIZE_REQUEST);

  const reader = proc.stdout?.getReader();
  let stdout = "";
  let gotInitializeResponse = false;
  const readDeadline = Date.now() + 10_000;
  while (Date.now() < readDeadline && !gotInitializeResponse) {
    const next = reader ? await reader.read() : null;
    if (!next || next.done) break;
    stdout += new TextDecoder().decode(next.value);
    gotInitializeResponse =
      stdout.includes('"jsonrpc":"2.0"') && stdout.includes('"id":1') && stdout.includes("protocolVersion");
  }
  const readTimedOut = !gotInitializeResponse && Date.now() >= readDeadline;

  // Close stdin so the stdio transport sees EOF and the server can exit.
  proc.stdin?.end();
  const stderrPromise = readStream(proc.stderr);
  // Wait a bounded time for the process to exit after EOF.
  const exitTimedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, 5_000);
    }),
  ]);
  const stderr = await stderrPromise;
  return {
    stdout,
    stderr,
    exitCode: proc.exitCode,
    timedOut: readTimedOut || exitTimedOut,
    gotInitializeResponse,
  };
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

  test("plain mcp (no early args) reaches the stdio transport and answers an initialize round-trip", async () => {
    // No early arg: the stdio transport must actually be connected and serving
    // JSON-RPC. We drive one initialize request/response over stdin/stdout — a
    // regression that swallowed or skipped the start path would emit no
    // JSON-RPC response and fail this probe, closing the vacuous-gap in the
    // previous version of this test (which only asserted rc=0 on stdin EOF).
    const result = await driveStdioInitialize();
    // A real JSON-RPC initialize response proves the stdio transport is
    // connected and serving — neither the --version nor the --help early-arg
    // handler can produce one. (The response's serverInfo.version legitimately
    // carries the package version, so the bare-version negative is not used.)
    expect(result.gotInitializeResponse).toBe(true);
    expect(result.stdout).not.toContain("Usage:");
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
  });
});
