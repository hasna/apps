import { describe, expect, test } from "bun:test";

import { VERSION } from "../version.js";

/**
 * Regression guard for the control-surface gap class (O15-00764).
 *
 * `releases-mcp` is a bin named in package.json, so agents probe it
 * with `releases-mcp --version` the same way they probe `releases
 * --version`. Before this fix the MCP entrypoint only answered
 * `--help`/`-h`; `--version` fell through to the stdio bind, which on
 * a closed/non-TTY stdin exits rc=0 printing NOTHING — the exact
 * "failed install" signature the CLI version-parity test exists for.
 *
 * The fix keeps the version source the same as the CLI and the MCP
 * server's advertised version: src/version.ts.
 */

function runMcpBin(args: string[]): Promise<{ stdout: string; exitCode: number | null }> {
  const proc = Bun.spawn(["bun", "run", "src/mcp/index.ts", ...args], {
    cwd: import.meta.dir + "/../..",
    stdout: "pipe",
    stderr: "pipe",
  });

  const killTimer = setTimeout(() => {
    proc.kill();
  }, 10_000);

  return (async () => {
    let stdout = "";
    for await (const chunk of proc.stdout) {
      stdout += new TextDecoder().decode(chunk);
    }
    const exitCode = await proc.exited;
    clearTimeout(killTimer);
    return { stdout, exitCode };
  })();
}

describe("releases-mcp control surface", () => {
  test("--version prints VERSION and exits without binding", async () => {
    const { stdout, exitCode } = await runMcpBin(["--version"]);
    expect(stdout.trim()).toBe(VERSION);
    expect(exitCode).toBe(0);
  });

  test("-V prints VERSION and exits without binding", async () => {
    const { stdout, exitCode } = await runMcpBin(["-V"]);
    expect(stdout.trim()).toBe(VERSION);
    expect(exitCode).toBe(0);
  });

  test("--help prints usage and exits without binding", async () => {
    const { stdout, exitCode } = await runMcpBin(["--help"]);
    expect(stdout).toContain("Usage: releases-mcp");
    expect(exitCode).toBe(0);
  });
});
