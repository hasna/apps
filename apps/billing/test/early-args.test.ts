import { describe, expect, test } from "bun:test";

/**
 * Regression tests for the binds-before-help class (BUG row ad3ae2fe).
 *
 * billing-serve --help and --version answered by BINDING the server first:
 * both timed out (rc=124) printing
 *
 *   billing serve on http://127.0.0.1:3487 (backend=sqlite)
 *   API auth disabled (SQLite loopback dev only)
 *
 * and never printed help or the version — the serve entry called
 * startServer() (guard -> DB warm -> Bun.serve) before any early-exit
 * argument was considered. Same defect class as @hasna/attachments
 * (fixed in PR 766) and @hasna/calendar.
 *
 * The probes are two-sided: --help/--version must answer rc=0 WITHOUT bind
 * or credential guard (positive), and plain serve must STILL reach the
 * startup sequence and refuse without credentials under a deliberately
 * unsafe (non-loopback) environment — never a silent skip (negative).
 */

const SERVE_ENTRY = new URL("../src/server/index.ts", import.meta.url).pathname;
/** Distinctive high port so a probe can tell "bound" from "did not bind". */
const PINNED_PORT = "43981";

async function runServe(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}> {
  // Deliberately unsafe env: a non-loopback bind with NO credentials trips
  // assertServeSafeToStart if the start path is reached at all.
  const env: Record<string, string | undefined> = {
    ...process.env,
    HASNA_BILLING_BIND_HOST: "0.0.0.0",
    HASNA_BILLING_PORT: PINNED_PORT,
    HASNA_BILLING_API_CREDENTIALS: undefined,
  };
  const proc = Bun.spawn(["bun", "run", SERVE_ENTRY, ...args], {
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

describe("billing-serve early arguments (binds-before-help class, BUG ad3ae2fe)", () => {
  test("--help answers with usage on stdout, rc=0, without binding or credential guard", async () => {
    const result = await runServe("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("billing-serve");
    // The regression: the old binary bound the server (rc=124 timeout) or
    // died on the credential guard instead of answering. Neither the bind
    // line nor the guard refusal may appear when --help is answered.
    expect(result.stderr).not.toContain("Refusing to start");
    expect(result.stderr).not.toContain("billing serve on");
    expect(result.stdout).not.toContain("billing serve on");
  });

  test("--version answers with the package version on stdout, rc=0, without binding or credential guard", async () => {
    const result = await runServe("--version");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(result.stderr).not.toContain("Refusing to start");
    expect(result.stderr).not.toContain("billing serve on");
    expect(result.stdout).not.toContain("billing serve on");
  });

  test(
    "plain serve (no early args) still reaches the startup sequence and refuses without credentials (negative probe)",
    async () => {
      // The real serve path must be unchanged by the early-args fix: with no
      // --help/--version, the entry still runs assertServeSafeToStart, which
      // in a deliberately credential-less non-loopback environment refuses
      // with the fail-closed fatal. A fix that swallowed or skipped the start
      // path would regress this side.
      const result = await runServe();
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Refusing to start: billing-serve is bound to a non-loopback interface");
    },
    15_000,
  );
});
