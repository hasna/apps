import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { packageVersion } from "../lib/version.js";

/**
 * Regression tests for the binds-before-version class (todos row 7e5f8f3d).
 *
 * loops-mcp --version/--help previously fell through to
 * isStdioMode()/startMcpHttpServer() and bound :8890 before any argument
 * classification (the list-tools special case was handled; --version/--help
 * were not).
 *
 * The probes are two-sided: --version/--help must answer rc=0 with version or
 * usage on stdout and NO bind marker (positive), and the plain path must STILL
 * take the real server path — the bind marker appears and the process keeps
 * serving until killed (negative).
 */

const LOOPS_ROOT = join(import.meta.dir, "../..");

let portCounter = 0;
function nextPort(): string {
  portCounter += 1;
  return String(40000 + ((process.pid + portCounter) % 20000));
}

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
    cwd: LOOPS_ROOT,
    env: { ...process.env, MCP_HTTP_PORT: nextPort() },
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
      }, 4_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, exitCode: proc.exitCode, timedOut };
}

describe("loops-mcp answers --version/--help before any bind (row 7e5f8f3d)", () => {
  test("--version prints the package version and exits without binding", async () => {
    const result = await runMcp(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageVersion());
    expect(result.stdout + result.stderr).not.toContain("HTTP listening on");
  });

  test("-V prints the package version and exits without binding", async () => {
    const result = await runMcp(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageVersion());
    expect(result.stdout + result.stderr).not.toContain("HTTP listening on");
  });

  test("--help prints usage and exits without binding", async () => {
    const result = await runMcp(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: loops-mcp");
    expect(result.stdout + result.stderr).not.toContain("HTTP listening on");
  });

  test("plain loops-mcp still starts the HTTP server (negative probe)", async () => {
    // No early arg: the real HTTP server path must still be taken — the bind
    // marker appears and the process keeps serving until killed. A fix that
    // swallowed the start path would regress this side.
    const result = await runMcp([]);
    expect(result.timedOut).toBe(true);
    expect(result.stdout + result.stderr).toContain("HTTP listening on");
  });
});
