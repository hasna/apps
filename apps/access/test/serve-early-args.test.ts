import { describe, expect, test } from "bun:test";
import { handleEarlyArgs } from "../src/server/index.js";

const SERVE_ENTRY = new URL("../src/server/index.ts", import.meta.url).pathname;

/**
 * Spawn access-serve with the port pinned to a distinctive high port, so a
 * probe can tell "bound" from "did not bind" without colliding with anything
 * on the default 3483. The help/version probes must answer WITHOUT binding —
 * a pass cannot be vacuous: the process must exit 0 with the port never
 * listening (binds-before-args class, BUG row 2920eed6).
 */
async function runServe(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HASNA_ACCESS_PORT: "49273",
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

describe("access-serve early arguments (binds-before-args class, BUG 2920eed6)", () => {
  test("--help answers with usage on stdout, rc=0, without binding the port", async () => {
    const result = await runServe("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("access-serve");
    // The regression: the old binary bound http://127.0.0.1:3483 and hung
    // instead of answering. The "listening on" line is the bind signature.
    expect(result.stderr).not.toContain("listening on");
  });

  test("--version answers with the package version on stdout, rc=0, without binding the port", async () => {
    const result = await runServe("--version");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(result.stderr).not.toContain("listening on");
  });

  test("handleEarlyArgs classifies help, version, and start", () => {
    expect(handleEarlyArgs(["--help"])).toBe("help");
    expect(handleEarlyArgs(["-h"])).toBe("help");
    expect(handleEarlyArgs(["--version"])).toBe("version");
    expect(handleEarlyArgs(["-V"])).toBe("version");
    expect(handleEarlyArgs([])).toBe("start");
    expect(handleEarlyArgs(["--help", "--version"])).toBe("help");
  });

  test(
    "plain serve refuses to bind without PostgreSQL and authentication configuration",
    async () => {
      const result = await runServe();
      expect(result.timedOut).toBe(false);
      expect(result.stderr).not.toContain("listening on");
      expect(result.stderr).toContain("could not start");
    },
    15_000,
  );
});
