import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * Regression tests for the backend-before-help class (todos row 3c0da7fd).
 *
 * conversations-serve --help/--version previously fell through to
 * startApiServer() -> buildDeps() -> createServerPoolFromEnv ->
 * resolveDatabaseUrl, which throws when HASNA_CONVERSATIONS_DATABASE_URL is
 * unset: the bin exited rc=1 with a stack trace and EMPTY stdout. Same defect
 * class as tickets-serve (row 5fcf7a67, PR 848), styles-mcp (row 0d02f8b9,
 * PR 844) and calendar-mcp (row 06003b88, PR 838).
 *
 * The probes are two-sided: --help/--version must answer rc=0 with usage or
 * version on stdout under a database-URL-free env (positive), and plain serve
 * must STILL take the real start path — it reaches the bind and keeps serving
 * until killed (negative). A fix that swallowed the start path would regress
 * the negative side.
 */

const CONVERSATIONS_ROOT = join(import.meta.dir, "../..");
/** Distinctive high port so a probe can tell "bound" from "did not bind". */
const PINNED_PORT = "49307";

async function runServe(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}> {
  // The regression requires the database URL to be ABSENT: without it, the
  // old entry died in backend resolution before answering --help/--version.
  // Delete both URL vars even if the ambient shell sets them.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.HASNA_CONVERSATIONS_DATABASE_URL;
  delete env.HASNA_CONVERSATIONS_API_URL;
  env.PORT = PINNED_PORT;
  const proc = Bun.spawn([process.execPath, "src/server/serve-entry.ts", ...args], {
    cwd: CONVERSATIONS_ROOT,
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

describe("conversations-serve early arguments (backend-before-help class, row 3c0da7fd)", () => {
  test("--help answers with usage on stdout, rc=0, without backend resolution", async () => {
    const result = await runServe("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("conversations-serve");
    // The regression: the old entry fell through to backend resolution and
    // died with the database-URL error; nothing was printed.
    expect(result.stdout).not.toContain("needs a database URL");
    expect(result.stderr).not.toContain("needs a database URL");
  }, 15_000);

  test("--version answers with the package version on stdout, rc=0, without backend resolution", async () => {
    const result = await runServe("--version");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
    expect(result.stdout).not.toContain("needs a database URL");
    expect(result.stderr).not.toContain("needs a database URL");
  }, 15_000);

  test(
    "plain serve (no early args) still takes the start path (negative probe)",
    async () => {
      // The real serve path must be unchanged by the early-args fix: with no
      // --help/--version, the entry still calls startApiServer, reaches the
      // bind on the pinned port, prints the bind marker, and keeps serving
      // until killed. A fix that swallowed or skipped the start path would
      // regress this side.
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
      }
      delete env.HASNA_CONVERSATIONS_API_URL;
      // Fake DSN + fake signing key: pool construction is lazy, so the bind
      // is reachable without a real database. The point is the START PATH,
      // not the database. Both values are deliberately non-credential-shaped
      // sentinels: resolveDatabaseUrl only requires a non-empty value, so a
      // URL-shaped fake DSN (postgresql://...) is unnecessary and trips the
      // credential scanner.
      env.HASNA_CONVERSATIONS_DATABASE_URL = "postgresql-placeholder-dsn-for-bind-probe";
      env.HASNA_CONVERSATIONS_API_SIGNING_KEY = "test-signing-key-for-negative-probe";
      env.PORT = PINNED_PORT;
      const proc = Bun.spawn([process.execPath, "src/server/serve-entry.ts"], {
        cwd: CONVERSATIONS_ROOT,
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
      expect(timedOut).toBe(true);
      expect(stdout).toContain(`conversations-serve listening on http://0.0.0.0:${PINNED_PORT}`);
      expect(stderr).not.toContain("needs a database URL");
    },
    15_000,
  );
});
