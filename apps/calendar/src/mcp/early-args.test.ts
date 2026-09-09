import { describe, expect, test } from "bun:test";

/**
 * Regression tests for the binds-before-version class (BUG row 06003b88).
 *
 * calendar-mcp --version answered nothing: the mcp entry parsed only --http
 * mode args (parseHttpArgv), then unconditionally built the MCP server and
 * awaited server.connect(transport) on StdioServerTransport — blocking on
 * stdin for JSON-RPC instead of answering. Measured on station01 with the
 * published bin: `timeout 20 calendar-mcp --version` -> rc=124, 0 bytes
 * stdout, 0 bytes stderr (@hasna/calendar 0.3.5). Same defect class as the
 * serve bin (BUG dd27cac0, fixed in 0.3.5) — the mcp entry was not covered.
 *
 * The probes are two-sided: --help/--version must answer rc=0 WITHOUT
 * entering the stdio loop (positive), and a plain run (no early args) must
 * STILL take the real MCP path — which is the #1720 fail-closed startup gate
 * first, and a configured run then stays on the stdio server (negative:
 * with no credential it refuses instead of serving).
 */

const MCP_ENTRY = new URL("./index.ts", import.meta.url).pathname;

async function runMcp(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}> {
  const env: Record<string, string> = { ...process.env };
  for (const key of [
    "HASNA_CALENDAR_DATABASE_URL",
    "CALENDAR_DATABASE_URL",
    "DATABASE_URL",
    "HASNA_CALENDAR_API_URL",
    "CALENDAR_API_URL",
    "HASNA_CALENDAR_API_KEY",
    "CALENDAR_API_KEY",
  ]) {
    delete env[key];
  }
  const proc = Bun.spawn(["bun", "run", MCP_ENTRY, ...args], {
    stdin: "pipe",
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

describe("calendar-mcp early arguments (binds-before-version class, BUG 06003b88)", () => {
  test("--version answers with the package version on stdout, rc=0, without entering the stdio loop", async () => {
    const result = await runMcp("--version");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.stderr).toBe("");
  });

  test("-V answers with the package version on stdout, rc=0", async () => {
    const result = await runMcp("-V");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("--help answers with usage on stdout, rc=0, without entering the stdio loop", async () => {
    const result = await runMcp("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("calendar-mcp");
  });

  test(
    "plain run (no early args) with no credential fails closed before entering the stdio loop",
    async () => {
      // The #1720 fail-closed startup gate: with no resolvable credential the
      // MCP entry refuses BEFORE the stdio transport connects — non-zero exit,
      // empty stdout, the refusal as the first stderr line (the preload pins
      // the Keychain account and the hasna home, so nothing ambient can
      // resolve). A regression that swallowed the gate would serve and stay
      // alive on stdin; one that skipped the stdio path for CONFIGURED runs
      // is caught by the fail-closed-startup control instead.
      const result = await runMcp();
      expect(result.timedOut).toBe(false);
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr.split("\n")[0]).toMatch(/^calendar-mcp: refusing to start/);
    },
    15_000,
  );
});
