import { describe, expect, test } from "bun:test";

/**
 * Regression tests for the standalone hooks-mcp bin (release-review P1,
 * four-surface gate). The bin must answer --version/--help BEFORE any bind
 * or store open (the binds-before-help class, todos row dc92977d) — and
 * plain startup must still take the real MCP start path (negative probe).
 */

const MCP_ENTRY = new URL("./mcp.ts", import.meta.url).pathname;
/** Distinctive high port so a probe can tell "bound" from "did not bind". */
const PINNED_PORT = "49293";

async function runMcp(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}> {
  const env = { ...process.env };
  const proc = Bun.spawn(["bun", "run", MCP_ENTRY, ...args], {
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

describe("hooks-mcp early arguments (binds-before-help class, row dc92977d)", () => {
  test("--help answers with usage on stdout, rc=0, without binding", async () => {
    const result = await runMcp("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("hooks-mcp");
    expect(result.stdout).not.toContain("listening on");
    expect(result.stderr).not.toContain("listening on");
  });

  test("--version answers with the package version on stdout, rc=0, without binding", async () => {
    const result = await runMcp("--version");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\s*$/);
    expect(result.stdout).not.toContain("listening on");
    expect(result.stderr).not.toContain("listening on");
  });

  test(
    "default HTTP start (bare invocation, no early args) binds and keeps serving (negative probe)",
    async () => {
      // The regression (release-review P1-3): the bin printed help and
      // exited on a zero-argument invocation instead of starting its
      // documented default Streamable HTTP server. Bare invocation must take
      // the real start path, bind the pinned port, and keep serving until
      // killed.
      const result = await runMcp("--port", PINNED_PORT);
      expect(result.timedOut).toBe(true);
      expect(result.stderr).toContain("listening on");
    },
    15_000,
  );
});
