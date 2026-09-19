import { describe, expect, test } from "bun:test";

/**
 * Regression tests for the binds-before-help class (BUG row 970d7c6f).
 *
 * attachments-serve --help and --version answered with rc=1 and
 *
 *   [attachments-serve] fatal: createCloudPoolFromEnv requires attachments
 *   storage mode 'cloud', got 'local'. Set HASNA_ATTACHMENTS_STORAGE_MODE=cloud.
 *
 * on stderr instead of help — the serve entry created the DB pool (and ran
 * migrations) before any early-exit argument was considered. Same defect class
 * as @hasna/access row 2920eed6 (fixed in PR 712).
 *
 * The probes are two-sided: --help/--version must answer rc=0 WITHOUT pool
 * creation (positive), and plain serve must STILL create the pool on the real
 * path — under a deliberately broken (local-mode) environment that means the
 * same createCloudPoolFromEnv fatal, never a silent skip (negative).
 */

const SERVE_ENTRY = new URL("./index.ts", import.meta.url).pathname;
/** Distinctive high port so a probe can tell "bound" from "did not bind". */
const PINNED_PORT = "49274";

async function runServe(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HASNA_ATTACHMENTS_STORAGE_MODE: "local",
    PORT: PINNED_PORT,
    HASNA_ATTACHMENTS_API_URL: undefined,
    HASNA_ATTACHMENTS_API_KEY: undefined,
  };
  const proc = Bun.spawn([process.execPath, "run", SERVE_ENTRY, ...args], {
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

describe("attachments-serve early arguments (binds-before-help class, BUG 970d7c6f)", () => {
  test("--help answers with usage on stdout, rc=0, without creating the DB pool", async () => {
    const result = await runServe("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("attachments-serve");
    // The regression: the old binary died on pool creation instead of
    // answering. Pool creation is what prints the createCloudPoolFromEnv
    // fatal; binding is what prints the "listening on" line. Neither may
    // appear when --help is answered.
    expect(result.stderr).not.toContain("createCloudPoolFromEnv");
    expect(result.stderr).not.toContain("fatal");
    expect(result.stderr).not.toContain("listening on");
    expect(result.stdout).not.toContain("listening on");
  });

  test("--version answers with the package version on stdout, rc=0, without creating the DB pool", async () => {
    const result = await runServe("--version");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(result.stderr).not.toContain("createCloudPoolFromEnv");
    expect(result.stderr).not.toContain("fatal");
    expect(result.stderr).not.toContain("listening on");
    expect(result.stdout).not.toContain("listening on");
  });

  test(
    "plain serve (no early args) still attempts pool creation and fails identically (negative probe)",
    async () => {
      // The real serve path must be unchanged by the early-args fix: with no
      // --help/--version, the entry still creates the pool from env, which in
      // a deliberately local-mode environment fails with the pool fatal. A
      // fix that swallowed or skipped pool creation would regress this side.
      const result = await runServe();
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("[attachments-serve] fatal:");
      expect(result.stderr).toContain("startup failed");
    },
    15_000,
  );
});
