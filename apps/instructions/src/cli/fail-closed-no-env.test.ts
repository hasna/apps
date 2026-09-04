import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempRoot } from "../lib/test-temp-root";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const API_URL_ENV = "HASNA_INSTRUCTIONS_API_URL";
const API_KEY_ENV = "HASNA_INSTRUCTIONS_API_KEY";
const LOCAL_OPT_IN_ENV = "HASNA_INSTRUCTIONS_LOCAL";

/**
 * CLI-level fail-closed regression (owner directive 2026-09-04).
 *
 * A CLI run WITHOUT the fleet API env must exit non-zero with an actionable
 * error naming the required env — it must never silently open the on-box
 * SQLite store (~/.hasna/instructions/instructions.db) and exit 0. The local
 * store works only with the explicit opt-in HASNA_INSTRUCTIONS_LOCAL=1.
 *
 * Every child env is scrubbed of the store-selecting variables (including the
 * local opt-in, which the test-runner preload pins for the local-mode suite)
 * so each probe observes a genuinely env-less invocation.
 */
function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  const childEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of [
    API_URL_ENV,
    API_KEY_ENV,
    "HASNA_INSTRUCTIONS_DB_PATH",
    "HASNA_CONFIGS_HOME",
    "HASNA_CONFIG_HOME",
    "HASNA_DATA_HOME",
    "HASNA_STATE_HOME",
    "HASNA_CACHE_HOME",
    LOCAL_OPT_IN_ENV,
  ]) {
    delete childEnv[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[key] = value;
  }
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...childEnv,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
}

describe("fail closed without the fleet API env", () => {
  test("whoami exits non-zero naming the required env and creates no local db", () => {
    const home = makeTempRoot("fc-instructions-noenv-");
    const result = runCli(["whoami"], { HOME: home });
    expect(result.status).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain(API_URL_ENV);
    expect(output).toContain(API_KEY_ENV);
    expect(output).toContain(LOCAL_OPT_IN_ENV);
    // The refusal must leave zero local storage behind.
    expect(existsSync(join(home, ".hasna", "instructions", "instructions.db"))).toBe(false);
    expect(existsSync(join(home, ".hasna", "instructions"))).toBe(false);
  });

  test("list exits non-zero naming the required env and creates no local db", () => {
    const home = makeTempRoot("fc-instructions-noenv-");
    const result = runCli(["list"], { HOME: home });
    expect(result.status).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain(API_URL_ENV);
    expect(output).toContain(API_KEY_ENV);
    expect(existsSync(join(home, ".hasna", "instructions", "instructions.db"))).toBe(false);
  });

  test("exactly one API var set still exits non-zero (no silent local drift)", () => {
    const home = makeTempRoot("fc-instructions-onevar-");
    const result = runCli(["list"], { HOME: home, [API_URL_ENV]: "https://instructions.hasna.xyz" });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("requires BOTH");
    expect(result.stdout + result.stderr).toContain(LOCAL_OPT_IN_ENV);
    expect(existsSync(join(home, ".hasna", "instructions", "instructions.db"))).toBe(false);
  });

  test("explicit local opt-in still opens the local store and exits 0", () => {
    const home = makeTempRoot("fc-instructions-localopt-");
    const result = runCli(["whoami"], { HOME: home, [LOCAL_OPT_IN_ENV]: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(join(home, ".hasna", "instructions", "instructions.db"));
    expect(existsSync(join(home, ".hasna", "instructions", "instructions.db"))).toBe(true);
  });

  test("help needs no store and still exits 0 without env", () => {
    const home = makeTempRoot("fc-instructions-help-");
    const result = runCli(["--help"], { HOME: home });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: instructions");
  });
});
