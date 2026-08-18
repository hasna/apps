import { describe, expect, test } from "bun:test";
import { APP_VERSION } from "../src/version.js";

/**
 * The serve bin must answer --help / --version WITHOUT binding a socket.
 * Regression: `consolidations-serve --help` used to fall through to Bun.serve
 * and hang (binds-before-version, filed O15-00063).
 */
interface BinResult {
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
}

const TIMEOUT_MS = 6000;

async function runServerBin(args: string[]): Promise<BinResult> {
  const proc = Bun.spawn({
    cmd: ["bun", "src/server/index.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, TIMEOUT_MS);
  const exitCode = await proc.exited;
  clearTimeout(timer);
  const stdout = await new Response(proc.stdout).text();
  await new Response(proc.stderr).text();
  return { exitCode, stdout, timedOut };
}

describe("serve bin argv handling", () => {
  test("--help prints usage and exits 0 without binding", async () => {
    const { exitCode, stdout, timedOut } = await runServerBin(["--help"]);
    expect(timedOut).toBe(false);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: consolidations-serve");
    expect(stdout).toContain("--version");
    expect(stdout).toContain("HASNA_CONSOLIDATIONS_PORT");
  });

  test("-h prints usage and exits 0", async () => {
    const { exitCode, stdout, timedOut } = await runServerBin(["-h"]);
    expect(timedOut).toBe(false);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: consolidations-serve");
  });

  test("--version prints the package version and exits 0", async () => {
    const { exitCode, stdout, timedOut } = await runServerBin(["--version"]);
    expect(timedOut).toBe(false);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(APP_VERSION);
  });

  test("-V prints the package version and exits 0", async () => {
    const { exitCode, stdout, timedOut } = await runServerBin(["-V"]);
    expect(timedOut).toBe(false);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(APP_VERSION);
  });
});
