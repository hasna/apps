import { describe, expect, test } from "bun:test";

/**
 * Regression tests for the binds-before-help class (BUG row dd27cac0).
 *
 * calendar-serve --help answered with rc=1 and
 *
 *   Starting calendar server on port 19428...
 *   calendar-serve: refusing to start — no serve credential is configured, and this
 *   server would otherwise expose /mcp (…)
 *
 * on stdout/stderr instead of help — the serve entry had no early --help branch,
 * so it fell through to the bind path, which resolves the auth posture and
 * refuses without a serve credential before any help could answer. Same defect
 * class as attachments-serve (BUG row 970d7c6f, PR 766) and access-serve
 * (row 2920eed6, PR 712).
 *
 * The probes are two-sided: --help/--version must answer rc=0 WITHOUT starting
 * the server (positive), and plain serve must STILL take the real start path —
 * under a deliberately credential-free environment that means the same
 * "refusing to start" fatal, never a silent skip (negative).
 */

const SERVE_ENTRY = new URL("./index.ts", import.meta.url).pathname;
/** Distinctive high port so a probe can tell "bound" from "did not bind". */
const PINNED_PORT = "49291";

async function runServe(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}> {
  const env: Record<string, string> = { ...process.env };
  for (const key of [
    "CALENDAR_SERVE_API_KEY",
    "HASNA_CALENDAR_SERVE_API_KEY",
    "CALENDAR_ALLOW_ANONYMOUS",
    "HASNA_CALENDAR_DATABASE_URL",
    "CALENDAR_DATABASE_URL",
    "DATABASE_URL",
    "HASNA_CALENDAR_API_URL",
    "CALENDAR_API_URL",
    "HASNA_CALENDAR_API_KEY",
    "CALENDAR_API_KEY",
    "HASNA_CALENDAR_API_KEY_OVERRIDE",
    "HASNA_CALENDAR_API_KEY_REF",
    "HASNA_PROFILE",
    "HASNA_CALENDAR_MODE",
    "CALENDAR_MODE",
    "HASNA_CALENDAR_STORAGE_MODE",
    "CALENDAR_STORAGE_MODE",
    "HASNA_CALENDAR_LOCAL",
    "CALENDAR_LOCAL",
  ]) {
    delete env[key];
  }
  env.PORT = PINNED_PORT;
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

describe("calendar-serve early arguments (binds-before-help class, BUG dd27cac0)", () => {
  test("--help answers with usage on stdout, rc=0, without starting the server", async () => {
    const result = await runServe("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("calendar-serve");
    // The regression: the old entry fell through to the bind path instead of
    // answering. "Starting calendar server on port" is the bind-path marker;
    // "Calendar server listening" is the socket-bound marker; the credential
    // refusal is what the start path dies on. None may appear when --help is
    // answered.
    expect(result.stdout).not.toContain("Starting calendar server on port");
    expect(result.stderr).not.toContain("Starting calendar server on port");
    expect(result.stderr).not.toContain("Calendar server listening");
    expect(result.stderr).not.toContain("refusing to start");
  });

  test("--version answers with the package version on stdout, rc=0, without starting the server", async () => {
    const result = await runServe("--version");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(result.stdout).not.toContain("Starting calendar server on port");
    expect(result.stderr).not.toContain("Starting calendar server on port");
    expect(result.stderr).not.toContain("Calendar server listening");
    expect(result.stderr).not.toContain("refusing to start");
  });

  test(
    "plain serve (no early args) still attempts the start path and refuses without a credential (negative probe)",
    async () => {
      // The real serve path must be unchanged by the early-args fix: with no
      // --help/--version, the entry still takes the start path, which in a
      // deliberately credential-free environment prints the bind-path marker
      // and dies with the credential refusal. A fix that swallowed or skipped
      // the auth guard would regress this side.
      const result = await runServe();
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("Starting calendar server on port");
      expect(result.stderr).toContain("HASNA_CALENDAR_DATABASE_URL is required");
      expect(result.stderr).toContain("before serving Calendar traffic");
    },
    15_000,
  );
});
