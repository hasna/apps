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
 * The default with HASNA_CONFIGS_HOME unset must be ~/.hasna/instructions
 * (never ~/.hasna/configs, another app's home), and every shipped local
 * storage path (whoami's DB path, the SQLite store) must derive from it.
 * HASNA_CONFIGS_HOME must remain a working override.
 */
function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HASNA_INSTRUCTIONS_API_URL: "",
      HASNA_INSTRUCTIONS_API_KEY: "",
      HASNA_INSTRUCTIONS_DB_PATH: "",
      HASNA_CONFIGS_HOME: "",
      ...env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
}

describe("canonical data root (raw store root)", () => {
  test("whoami defaults to ~/.hasna/instructions with HASNA_CONFIGS_HOME unset", () => {
    const home = makeTempRoot("ok-instructions-cli-root-");
    try {
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
});
