import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getPackageVersion } from "../lib/package-version.js";

/**
 * Regression tests for the binds-before-help class (todos row
 * c8067fdd-e41d-4840-be41-e493bfecff01, O15-00628).
 *
 * instructions-serve --help previously fell through to the Hono app export
 * and bound :3457, printing "instructions-serve listening on …" and serving
 * forever (rc=124 under timeout). --version was already handled; --help was
 * not (the T-00101 systematic fix, 8b70821, covered instructions-mcp /
 * configs-mcp but not the serve bin).
 *
 * The probes are two-sided: --help/--version must answer rc=0 with usage or
 * version on stdout and NO bind marker (positive), and the plain path must
 * STILL take the real server path — the bind marker appears and the process
 * keeps serving until killed (negative).
 */

const SERVER_ROOT = join(import.meta.dir, "../..");
const BIND_MARKER = "listening on http://";

let portCounter = 0;
function nextPort(): string {
  portCounter += 1;
  return String(50000 + ((process.pid + portCounter) % 20000));
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

async function runServe(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, "run", "src/server/index.ts", ...args], {
    cwd: SERVER_ROOT,
    env: { ...process.env, INSTRUCTIONS_PORT: nextPort() },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so the server cannot wait on it
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

describe("instructions-serve early args", () => {
  test("--help answers usage with rc=0 and does not bind", async () => {
    const r = await runServe(["--help"]);
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage: instructions-serve");
    expect(r.stdout + r.stderr).not.toContain(BIND_MARKER);
  });

  test("-h alias answers usage with rc=0 and does not bind", async () => {
    const r = await runServe(["-h"]);
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage: instructions-serve");
    expect(r.stdout + r.stderr).not.toContain(BIND_MARKER);
  });

  test("--version answers the package version with rc=0 and does not bind", async () => {
    const r = await runServe(["--version"]);
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(getPackageVersion());
    expect(r.stdout + r.stderr).not.toContain(BIND_MARKER);
  });

  test("plain invocation still takes the real server path (negative control)", async () => {
    const r = await runServe([]);
    // The server must have started (bind marker) — proving the guard does not
    // block the real path — and must keep serving until killed.
    expect(r.stdout).toContain(BIND_MARKER);
    expect(r.timedOut).toBe(true);
  });
});
