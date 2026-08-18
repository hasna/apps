import { describe, expect, it } from "bun:test";
import { APP_VERSION } from "../src/version.js";

/**
 * Regression: treasury-serve must answer --help/--version WITHOUT starting the
 * listener (recordings pattern). Before the fix the bin bound port 3486 and
 * hung instead of answering (task 4d33b941, P1).
 */
const ENTRY = new URL("../src/server/index.ts", import.meta.url).pathname;
const ARGV_TIMEOUT_MS = 8_000;

async function runServeArgv(args: string[]): Promise<{ rc: number; stdout: string; timedOut: boolean }> {
  const proc = Bun.spawn({ cmd: [process.execPath, ENTRY, ...args], stdout: "pipe", stderr: "pipe" });
  const stdout = (await new Response(proc.stdout).text()).trim();
  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, ARGV_TIMEOUT_MS);
  const rc = await proc.exited;
  clearTimeout(killTimer);
  return { rc, stdout, timedOut };
}

describe("treasury-serve argv handling", () => {
  it("--help answers with usage text and exits 0 without binding", async () => {
    const { rc, stdout, timedOut } = await runServeArgv(["--help"]);
    expect(timedOut).toBe(false);
    expect(rc).toBe(0);
    expect(stdout).toContain("Usage: treasury-serve");
    // Must NOT have reached the listener banner (proves no bind).
    expect(stdout).not.toContain("on http://");
  });

  it("-h answers with usage text and exits 0 without binding", async () => {
    const { rc, stdout, timedOut } = await runServeArgv(["-h"]);
    expect(timedOut).toBe(false);
    expect(rc).toBe(0);
    expect(stdout).toContain("Usage: treasury-serve");
    expect(stdout).not.toContain("on http://");
  });

  it("--version prints the package version and exits 0 without binding", async () => {
    const { rc, stdout, timedOut } = await runServeArgv(["--version"]);
    expect(timedOut).toBe(false);
    expect(rc).toBe(0);
    expect(stdout).toBe(APP_VERSION);
    expect(stdout).not.toContain("on http://");
  });

  it("-V prints the package version and exits 0 without binding", async () => {
    const { rc, stdout, timedOut } = await runServeArgv(["-V"]);
    expect(timedOut).toBe(false);
    expect(rc).toBe(0);
    expect(stdout).toBe(APP_VERSION);
    expect(stdout).not.toContain("on http://");
  });
});
