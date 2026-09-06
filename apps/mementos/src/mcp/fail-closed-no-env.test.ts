import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB_PATH_ENV_KEYS } from "../db/api-mode.js";
import { MEMENTOS_LOCAL_OPT_IN_ENV_KEYS } from "../lib/local-opt-in.js";
import { STORE_SELECTOR_ENV_KEYS } from "../test-support/store-isolation.js";

// ============================================================================
// End-to-end: the real MCP binary, in a real subprocess, with the store
// selectors scrubbed out of its environment (mirrors a coding agent that
// registered `mementos-mcp` on a station without the fleet credentials).
// The MCP must fail closed at STARTUP — before it spawns the companion
// `mementos-serve` process, which would create the on-box SQLite store — not
// merely refuse individual tool calls. A fake `mementos-serve` is placed first
// on PATH and records whether it was ever executed.
// ============================================================================

const MCP_PATH = new URL("./index.ts", import.meta.url).pathname;

function scrubbedMcpEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of [...STORE_SELECTOR_ENV_KEYS, ...DB_PATH_ENV_KEYS, ...MEMENTOS_LOCAL_OPT_IN_ENV_KEYS, "NODE_ENV", "MEMENTOS_DB_SCOPE"]) {
    delete env[key];
  }
  return { ...env, ...extra };
}

/** A `mementos-serve` stand-in that only proves it was launched. */
function fakeServeOnPath(scratch: string): { pathPrefix: string; marker: string } {
  const bin = join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  const marker = join(scratch, "serve-was-spawned");
  const script = join(bin, "mementos-serve");
  writeFileSync(script, `#!/bin/sh\n: > "${marker}"\nexit 0\n`);
  chmodSync(script, 0o755);
  return { pathPrefix: bin, marker };
}

async function runMcp(
  env: Record<string, string>,
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", MCP_PATH, "--stdio"], {
    env,
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  // Nothing to say: a closed stdin ends a stdio MCP session that did start.
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe("mementos MCP without store configuration fails closed at startup", () => {
  test("FAILING INPUT: env-less `mementos-mcp --stdio` exits non-zero, names the tiers, spawns no server, creates no local db", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "mementos-mcp-failclosed-noenv-"));
    const home = join(scratch, "home");
    const dataHome = join(scratch, "data");
    const { pathPrefix, marker } = fakeServeOnPath(scratch);
    const env = scrubbedMcpEnv({ HOME: home, HASNA_DATA_HOME: dataHome, PATH: `${pathPrefix}:${process.env["PATH"] ?? ""}` });

    const { stdout, stderr, exitCode } = await runMcp(env, scratch);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("HASNA_MEMENTOS_API_KEY");
    expect(stderr).toContain("HASNA_MEMENTOS_DB_PATH");
    expect(stdout).toBe("");

    // The companion server was never launched, and no store exists anywhere.
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(dataHome, "mementos.db"))).toBe(false);
    expect(existsSync(dataHome)).toBe(false);
    expect(existsSync(join(home, ".hasna", "mementos", "mementos.db"))).toBe(false);
  });

  test("control: the deliberate local flag (HASNA_MEMENTOS_LOCAL=1) starts the MCP and says it is local", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "mementos-mcp-failclosed-flag-"));
    const home = join(scratch, "home");
    const dataHome = join(scratch, "data");
    const { pathPrefix } = fakeServeOnPath(scratch);
    const env = scrubbedMcpEnv({
      HOME: home,
      HASNA_DATA_HOME: dataHome,
      HASNA_MEMENTOS_LOCAL: "1",
      PATH: `${pathPrefix}:${process.env["PATH"] ?? ""}`,
    });

    const { stderr, exitCode } = await runMcp(env, scratch);

    expect(exitCode).toBe(0);
    // Local mode must SAY it is local — on stderr (fail-closed wave).
    expect(stderr).toMatch(/local/i);
  }, 30_000);
});
