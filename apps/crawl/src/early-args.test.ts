import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { VERSION } from "./version.js";

/**
 * Regression tests for the binds-before-version class (todos row 7e5f8f3d).
 *
 * crawl-mcp --version/--help previously fell through to main()'s HTTP server
 * path and bound :8857 (crawl-serve :19700) before any argument
 * classification.
 *
 * The probes are two-sided: --version/--help must answer rc=0 with version or
 * usage on stdout and NO bind marker (positive), and the plain path must STILL
 * take the real server path — the bind marker appears and the process keeps
 * serving until killed (negative).
 */

const CRAWL_ROOT = join(import.meta.dir, "..");

let portCounter = 0;
function nextPort(base: number): string {
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

async function runEntry(entry: string, args: string[], port: string): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, "run", entry, ...args], {
    cwd: CRAWL_ROOT,
    env: { ...process.env, CRAWL_PORT: port },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so nothing can wait on it
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

describe("crawl-serve answers --version/--help before any bind (row 7e5f8f3d)", () => {
  test("--version prints the package version and exits without binding", async () => {
    const result = await runEntry("src/server/index.ts", ["--version"], nextPort(19700));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
    expect(result.stdout + result.stderr).not.toContain("crawl server running on");
  });

  test("-V prints the package version and exits without binding", async () => {
    const result = await runEntry("src/server/index.ts", ["-V"], nextPort(19700));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
    expect(result.stdout + result.stderr).not.toContain("crawl server running on");
  });

  test("--help prints usage and exits without binding", async () => {
    const result = await runEntry("src/server/index.ts", ["--help"], nextPort(19700));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: crawl-serve");
    expect(result.stdout + result.stderr).not.toContain("crawl server running on");
  });

  test("plain serve still binds and serves (negative probe)", async () => {
    const result = await runEntry("src/server/index.ts", [], nextPort(19700));
    expect(result.timedOut).toBe(true);
    expect(result.stdout + result.stderr).toContain("crawl server running on");
  });
});

describe("crawl-mcp answers --version/--help before any bind (row 7e5f8f3d)", () => {
  test("--version prints the package version and exits without binding", async () => {
    const result = await runEntry("src/mcp/index.ts", ["--version"], nextPort(8857));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
    expect(result.stdout + result.stderr).not.toContain("crawl server running on");
  });

  test("-V prints the package version and exits without binding", async () => {
    const result = await runEntry("src/mcp/index.ts", ["-V"], nextPort(8857));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
    expect(result.stdout + result.stderr).not.toContain("crawl server running on");
  });

  test("--help prints usage and exits without binding", async () => {
    const result = await runEntry("src/mcp/index.ts", ["--help"], nextPort(8857));
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: crawl-mcp");
    expect(result.stdout + result.stderr).not.toContain("crawl server running on");
  });
});
