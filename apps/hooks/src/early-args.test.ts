import { describe, expect, test } from "bun:test";

/**
 * Regression tests for the binds-before-help class (todos row dc92977d).
 *
 * hooks-serve --version previously fell through to startServeServer() and
 * bound the HTTP listener at 127.0.0.1:39428, printing
 * "hooks registry listening on http://127.0.0.1:39428 (publish requires an
 * API key)" to stderr and never exiting — measured `timeout 5 hooks-serve
 * --version` -> rc=124, empty stdout. Same defect class as calendar-serve
 * (row dd27cac0, PR 784), access-serve (row 2920eed6, PR 712), and
 * attachments-serve (row 970d7c6f, PR 766); hooks was the remaining member.
 *
 * The probes are two-sided: --help/--version must answer rc=0 with usage or
 * version on stdout and NO bind marker (positive), and plain serve must STILL
 * take the real start path — the bind marker appears and the process keeps
 * serving until killed (negative). A fix that swallowed the start path or
 * skipped the bind would regress the negative side.
 */

const SERVE_ENTRY = new URL("./serve.ts", import.meta.url).pathname;
/** Distinctive high port so a probe can tell "bound" from "did not bind". */
const PINNED_PORT = "49292";

async function runServe(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}> {
  const env = { ...process.env };
  // Deliberately credential-free: the start path must not depend on a serve
  // credential for the negative probe's determinism.
  for (const key of ["HASNA_HOOKS_API_KEY", "HOOKS_API_KEY"]) {
    delete env[key];
  }
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

describe("hooks-serve early arguments (binds-before-help class, row dc92977d)", () => {
  test("--help answers with usage on stdout, rc=0, without binding the listener", async () => {
    const result = await runServe("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("hooks-serve");
    // The regression: the old entry fell through to the bind path instead of
    // answering, so the listener bound at 39428 and the process never exited.
    // The bind marker is "listening on http://" on stderr; it may not appear
    // when --help is answered.
    expect(result.stdout).not.toContain("listening on");
    expect(result.stderr).not.toContain("listening on");
  });

  test("--version answers with the package version on stdout, rc=0, without binding the listener", async () => {
    const result = await runServe("--version");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(result.stdout).not.toContain("listening on");
    expect(result.stderr).not.toContain("listening on");
  });

  test(
    "plain serve (no early args) still binds and keeps serving (negative probe)",
    async () => {
      // The real serve path must be unchanged by the early-args fix: with no
      // --help/--version, the entry still takes the start path, binds the
      // pinned port, prints the bind marker on stderr, and keeps serving
      // until killed. A fix that swallowed or skipped the start path would
      // regress this side.
      const result = await runServe("--port", PINNED_PORT);
      expect(result.timedOut).toBe(true);
      expect(result.stderr).toContain(`listening on http://127.0.0.1:${PINNED_PORT}`);
    },
    15_000,
  );
});
