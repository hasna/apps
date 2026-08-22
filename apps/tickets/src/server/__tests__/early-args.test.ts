import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * Regression tests for the binds-before-help class (todos row 5fcf7a67).
 *
 * tickets-serve --help/--version previously fell through to serve() and bound
 * the listener before any argument classification: with the port occupied it
 * died at the bind with EADDRINUSE (rc=1, empty stdout); on a free port it
 * bound and served forever (rc=124 under timeout). Same defect class as
 * hooks-serve (row dc92977d, PR 840), calendar-serve (row dd27cac0, PR 784),
 * and access-serve (row 2920eed6, PR 712).
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

async function runServe(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}> {
  const env = { ...process.env, PORT: PINNED_PORT };
  // Deliberately isolate DB writes to a throwaway path: the real start path
  // opens the store, and the negative probe must never touch the live DB.
  env.HASNA_TICKETS_DB_PATH = join("/tmp", `tickets-early-args-${process.pid}.db`);
  const proc = Bun.spawn([process.execPath, "src/server/index.ts", ...args], {
    cwd: TICKETS_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
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
  return { stdout, stderr, code: proc.exitCode ?? -1, timedOut };
}

describe("tickets-serve early arguments (binds-before-help class, row 5fcf7a67)", () => {
  test("--help answers with usage on stdout, rc=0, without binding the listener", async () => {    const result = await runServe("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("tickets-serve");
    // The regression: the old entry fell through to the bind path instead of
    // answering, so the listener bound and the process never exited.
    expect(result.stdout).not.toContain("tickets server running");
    expect(result.stderr).not.toContain("tickets server running");
  }, 15_000);

  test("--version answers with the package version on stdout, rc=0, without binding the listener", async () => {
    const result = await runServe("--version");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(result.stdout).not.toContain("tickets server running");
    expect(result.stderr).not.toContain("tickets server running");
  }, 15_000);

  test(
    "plain serve (no early args) still binds and keeps serving (negative probe)",
    async () => {
      // The real serve path must be unchanged by the early-args fix: with no
      // --help/--version, the entry still takes the start path, binds the
      // pinned port, prints the bind marker, and keeps serving until killed.
      // A fix that swallowed or skipped the start path would regress this side.
      const result = await runServe();
      expect(result.timedOut).toBe(true);
      expect(result.stdout).toContain(`tickets server running on http://localhost:${PINNED_PORT}`);
    },
    15_000,
  );
});
