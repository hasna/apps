import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getPackageVersion } from "../../lib/package-info.ts";

/**
 * Regression tests for the binds-before-help class (todos row 5fcf7a67).
 *
 * tickets-mcp --version/--help previously fell through to main()'s transport
 * resolution, entered MCP stdio mode (or HTTP mode), printed nothing, and
 * exited rc=0 silently when stdin closed. Same defect class as styles-mcp
 * (row 0d02f8b9, PR 844) and calendar-mcp (row 06003b88, PR 838).
 *
 * The probes assert the exact contract: --version prints the package version
 * and --help prints usage, both rc=0, with no MCP protocol traffic.
 */

const TICKETS_ROOT = join(import.meta.dir, "../../..");

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runMcp(args: string[]) {
  const proc = Bun.spawn([process.execPath, "run", "src/mcp/index.ts", ...args], {
    cwd: TICKETS_ROOT,
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

describe("tickets-mcp answers --version/--help without binding", () => {
  test("--version prints the package version and exits", async () => {
    const result = await runMcp(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("--help prints usage and exits", async () => {
    const result = await runMcp(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("tickets-mcp");
    expect(result.stdout).not.toContain("jsonrpc");
  });
});
