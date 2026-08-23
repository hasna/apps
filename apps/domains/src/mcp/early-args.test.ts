import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getPackageVersion } from "../lib/version.js";

/**
 * Regression tests for the binds-before-version class (todos row 46a45765).
 *
 * domains-mcp --version/--help previously fell through to main(): the entry
 * classified argv only with isStdioMode(argv), so any other argv — including
 * --version and --help — bound the shared Streamable HTTP server
 * (resolveMcpHttpPort + startHttpServer, default port 8859) and then hung on
 * `await new Promise(() => {})`. With the port occupied, `domains-mcp
 * --version` died EADDRINUSE rc=1 printing nothing; with the port free it
 * bound and hung instead of answering. Same defect class as conversations-mcp
 * (row 3c0da7fd, PR 976), dispatch daemon/mcp (row 8a43ca44, PR 977),
 * tickets-mcp (row 5fcf7a67, PR 848), styles-mcp (row 0d02f8b9, PR 844) and
 * calendar-mcp (row 06003b88, PR 838).
 *
 * The probes are two-sided: --help/--version must answer rc=0 BEFORE any bind
 * (positive — and they must pass in BOTH port states, since --version must
 * answer before bind), and a plain --stdio run must STILL take the stdio MCP
 * server path — it connects the StdioServerTransport, prints its banner, and
 * stays alive reading stdin (negative), so a fix that swallows the start path
 * regresses and is caught.
 */

const PACKAGE_ROOT = join(import.meta.dir, "..", "..");
const MCP_ENTRY = "src/mcp/index.ts";
const PROBE_TIMEOUT_MS = 10_000;

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runMcp(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}> {
  const proc = Bun.spawn([process.execPath, "run", MCP_ENTRY, ...args], {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so a stdio server cannot wait on it
  const settled = await Promise.race([
    proc.exited.then((exitCode) => ({ exitCode, timedOut: false })),
    new Promise<{ exitCode: number; timedOut: boolean }>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve({ exitCode: -1, timedOut: true });
      }, PROBE_TIMEOUT_MS);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
  ]);
  return { stdout, stderr, ...settled };
}

describe("domains-mcp answers --version/--help before binding the HTTP server", () => {
  test("--version prints the package version and exits rc=0 without binding", async () => {
    const result = await runMcp(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout).not.toContain("jsonrpc");
    expect(result.stderr).not.toContain("EADDRINUSE");
  });

  test("-V prints the package version and exits rc=0 without binding", async () => {
    const result = await runMcp(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout).not.toContain("jsonrpc");
    expect(result.stderr).not.toContain("EADDRINUSE");
  });

  test("--help prints usage and exits rc=0 without binding", async () => {
    const result = await runMcp(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("domains-mcp");
    expect(result.stdout).not.toContain("jsonrpc");
    expect(result.stderr).not.toContain("EADDRINUSE");
  });

  test("-h prints usage and exits rc=0 without binding", async () => {
    const result = await runMcp(["-h"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("domains-mcp");
    expect(result.stderr).not.toContain("EADDRINUSE");
  });

  test(
    "plain --stdio run still takes the stdio MCP server path and stays alive on stdin (negative probe)",
    async () => {
      // The real stdio path must be unchanged by the early-args fix: with no
      // --help/--version, the entry still connects the stdio transport, prints
      // its banner, and reads stdin for JSON-RPC without exiting. stdin is an
      // open, silent pipe, so a regression that swallowed the stdio path (or
      // made plain runs exit immediately) would fail this probe.
      const proc = Bun.spawn([process.execPath, "run", MCP_ENTRY, "--stdio"], {
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
          }, PROBE_TIMEOUT_MS);
        }),
      ]);
      const stderr = await readStream(proc.stderr);
      await proc.exited;
      expect(timedOut).toBe(true);
      expect(stderr).toContain("domains MCP server running on stdio");
    },
    15_000,
  );
});
