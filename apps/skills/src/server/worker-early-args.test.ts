import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import pkg from "../../package.json" with { type: "json" };
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Regression tests for the binds-before-version class on the worker surface
 * (todos row 19140ea1 / O15-00621).
 *
 * skills-worker --version/--help previously fell through to
 * resolveServerConfig()/createStore() — opening the database and entering
 * the run loop before any argument classification, so the control surface
 * never answered (measured: hung until killed, storage line printed, no
 * version on stdout).
 *
 * The probes are two-sided, like the server's (row 7e5f8f3d):
 * --version/--help must answer rc=0 with version or usage on stdout and NO
 * storage marker (positive), and a plain run must STILL take the real boot
 * path — the storage marker appears and the process keeps polling until
 * killed (negative).
 */

const SKILLS_ROOT = join(import.meta.dir, "../..");
const STORAGE_MARKER = "skills worker";

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

async function runWorker(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, "run", "src/server/worker.ts", ...args], {
    cwd: SKILLS_ROOT,
    env: {
      ...process.env,
      HASNA_SKILLS_ALLOW_EPHEMERAL_STORE: "1",
      HASNA_SKILLS_DATABASE_URL: ":memory:",
    },
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

describe("skills-worker answers --version/--help before any bind (O15-00621)", () => {
  test("--version prints the package version and exits without opening the store", async () => {
    const result = await runWorker(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.stdout + result.stderr).not.toContain(STORAGE_MARKER);
  });

  test("-V prints the package version and exits without opening the store", async () => {
    const result = await runWorker(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.stdout + result.stderr).not.toContain(STORAGE_MARKER);
  });

  test("--help prints usage and exits without opening the store", async () => {
    const result = await runWorker(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: skills-worker");
    expect(result.stdout + result.stderr).not.toContain(STORAGE_MARKER);
  });

  test("plain run still boots into the poll loop (negative probe)", async () => {
    // No early arg: the real worker path must still be taken — the storage
    // marker appears and the process keeps polling until killed. A fix that
    // swallowed the boot path would regress this side.
    const result = await runWorker([]);
    expect(result.timedOut).toBe(true);
    expect(result.stdout + result.stderr).toContain(STORAGE_MARKER);
  });
});
