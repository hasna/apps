import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeTempRoot } from "../lib/test-temp-root";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * CLI-level regression for the canonical data root (raw store root).
 *
 * The default with HASNA_CONFIGS_HOME truly ABSENT (key deleted, never an
 * empty string - an empty string is a present key) must be
 * ~/.hasna/instructions (never ~/.hasna/configs, another app's home), and
 * every shipped local storage path (whoami's DB path, the SQLite store)
 * must derive from it. HASNA_CONFIGS_HOME must remain a working override.
 */
function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  // Build the child environment from the parent, then DELETE the
  // store-selecting variables: a child can only observe "HASNA_CONFIGS_HOME
  // unset" when the key is absent. Setting it to "" would leave a present
  // key and mask a default-root regression.
  const childEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete childEnv["HASNA_INSTRUCTIONS_API_URL"];
  delete childEnv["HASNA_INSTRUCTIONS_API_KEY"];
  delete childEnv["HASNA_INSTRUCTIONS_DB_PATH"];
  delete childEnv["HASNA_CONFIGS_HOME"];
  delete childEnv["HASNA_CONFIG_HOME"];
  delete childEnv["HASNA_DATA_HOME"];
  delete childEnv["HASNA_STATE_HOME"];
  delete childEnv["HASNA_CACHE_HOME"];
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

describe("canonical data root (raw store root)", () => {
  test("whoami defaults to ~/.hasna/instructions with HASNA_CONFIGS_HOME truly unset", () => {
    const home = makeTempRoot("ok-instructions-cli-root-");
    const previousRawHome = process.env["HASNA_CONFIGS_HOME"];
    delete process.env["HASNA_CONFIGS_HOME"];
    try {
      // The key must be ABSENT before spawning the CLI, not merely empty.
      expect(process.env["HASNA_CONFIGS_HOME"]).toBeUndefined();
      const result = runCli(["whoami"], { HOME: home });
      expect(result.status).toBe(0);
      const expected = join(home, ".hasna", "instructions", "instructions.db");
      expect(result.stdout).toContain(`DB: ${expected}`);
      // The shipped storage path actually created the store under the canonical root.
      expect(existsSync(join(home, ".hasna", "instructions", "instructions.db"))).toBe(true);
      // The old configs home must NOT be used.
      expect(existsSync(join(home, ".hasna", "configs"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
      if (previousRawHome === undefined) delete process.env["HASNA_CONFIGS_HOME"];
      else process.env["HASNA_CONFIGS_HOME"] = previousRawHome;
    }
  });

  test("HASNA_CONFIGS_HOME override still wins in the shipped path", () => {
    const home = makeTempRoot("ok-instructions-cli-root-override-");
    try {
      const override = join(home, "alt-root");
      const result = runCli(["whoami"], { HOME: home, HASNA_CONFIGS_HOME: override });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`DB: ${join(override, "instructions.db")}`);
      expect(existsSync(join(override, "instructions.db"))).toBe(true);
      expect(existsSync(join(home, ".hasna", "instructions"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("HASNA_CONFIG_HOME config-kind override adopts the XDG config home", () => {
    const home = makeTempRoot("ok-instructions-cli-root-xdg-");
    try {
      const base = join(home, "xdg-base");
      const result = runCli(["whoami"], { HOME: home, HASNA_CONFIG_HOME: base });
      expect(result.status).toBe(0);
      const expected = join(base, "configs", "instructions.db");
      expect(result.stdout).toContain(`DB: ${expected}`);
      expect(existsSync(expected)).toBe(true);
      // The legacy ~/.hasna/instructions store must NOT be created under the
      // config-kind override — the store moved to the XDG config home.
      expect(existsSync(join(home, ".hasna", "instructions"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a migrated store at the XDG config home is adopted without any override", () => {
    const home = makeTempRoot("ok-instructions-cli-root-migrated-");
    try {
      const resolved = join(home, ".config", "hasna", "configs");
      // Simulate a store already migrated to the resolver config home.
      const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "instructions.db"), "");
      const result = runCli(["whoami"], { HOME: home });
      expect(result.status).toBe(0);
      const expected = join(resolved, "instructions.db");
      expect(result.stdout).toContain(`DB: ${expected}`);
      expect(existsSync(expected)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
