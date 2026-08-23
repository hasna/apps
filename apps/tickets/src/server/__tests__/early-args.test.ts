import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getPackageVersion } from "../../lib/package-info.ts";

/**
 * Regression tests for the binds-before-help class (todos row 5fcf7a67).
 *
 * tickets-serve --help/--version previously fell through to serve() and bound
 * the listener before any argument classification: with the port occupied it
 * died at the bind with EADDRINUSE (rc=1, empty stdout); on a free port it
 * bound and served forever (rc=124 under timeout). Same defect class as
 * secrets-serve (row afd9e358, PR 1016), hooks-serve, calendar-serve, and
 * access-serve.
 *
 * The probes are two-sided: --help/--version must answer rc=0 with usage or
 * version on stdout and NO bind marker (positive), and plain serve must STILL
 * take the real start path — the bind marker appears and the process keeps
 * serving until killed (negative). A fix that swallowed the start path or
 * skipped the bind would regress the negative side.
 */

const TICKETS_ROOT = join(import.meta.dir, "../../..");
/** Distinctive high port so a probe can tell "bound" from "did not bind". */
const PINNED_PORT = "49293";
const BIND_MARKER = `tickets server running on http://localhost:${PINNED_PORT}`;

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

/** Spawn tickets-serve with a pinned port and an isolated throwaway DB. */
function spawnServe(args: string[]) {
  const dbPath = join("/tmp", `tickets-early-args-${process.pid}-${Date.now()}.db`);
  const env: Record<string, string> = {
    ...process.env,
    PORT: PINNED_PORT,
    HASNA_TICKETS_DB_PATH: dbPath,
  };
  const proc = Bun.spawn([process.execPath, "run", "src/server/index.ts", ...args], {
    cwd: TICKETS_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so nothing can wait on it
  return { proc, dbPath };
}

async function runServe(args: string[]): Promise<RunResult> {
  const { proc, dbPath } = spawnServe(args);
  const stdoutPromise = readStream(proc.stdout);
  const stderrPromise = readStream(proc.stderr);
  // 4s kill budget: under bun test's default 5s per-test timeout, so the
  // negative probe (which binds and serves forever by design) is killed by
  // this race and recorded as timedOut before the runner kills the test.
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
  try {
    await Bun.$`rm -f ${dbPath}`.quiet();
  } catch {}
  return { stdout, stderr, exitCode: proc.exitCode, timedOut };
}

describe("tickets-serve answers --version/--help before any bind (row 5fcf7a67)", () => {
  test("--version prints the package version and exits without binding", async () => {
    const result = await runServe(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout + result.stderr).not.toContain(BIND_MARKER);
  });

  test("-V prints the package version and exits without binding", async () => {
    const result = await runServe(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout + result.stderr).not.toContain(BIND_MARKER);
  });

  test("--help prints usage and exits without binding", async () => {
    const result = await runServe(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("usage: tickets-serve");
    expect(result.stdout + result.stderr).not.toContain(BIND_MARKER);
  });

  test("plain serve still takes the real boot path (negative probe)", async () => {
    // No early arg: the boot path must still be reached — the bind marker
    // appears and the process keeps serving until killed. A fix that
    // swallowed or skipped the start path would regress this side.
    const result = await runServe([]);
    expect(result.timedOut).toBe(true);
    expect(result.stdout + result.stderr).toContain(BIND_MARKER);
    expect(result.stdout).not.toContain(getPackageVersion());
    expect(result.stdout).not.toContain("usage: tickets-serve");
  });
});
