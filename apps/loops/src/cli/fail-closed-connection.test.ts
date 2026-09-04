import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

const API_URL_KEY = "HASNA_LOOPS_API_URL";
const API_KEY_KEY = "HASNA_LOOPS_API_KEY";
const CONNECTION_KEY = "HASNA_LOOPS_CONNECTION";

/**
 * Spawn env with the loops connection variables fully removed/blanked, so a
 * developer's own HASNA_LOOPS_API_URL/KEY/CONNECTION can never leak into the
 * fail-closed assertions. `extra` re-adds specific variables per test.
 */
function connectionEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === API_URL_KEY || key === API_KEY_KEY || key === CONNECTION_KEY) continue;
    env[key] = value;
  }
  return {
    ...env,
    [API_URL_KEY]: "",
    [API_KEY_KEY]: "",
    [CONNECTION_KEY]: "",
    ...extra,
  };
}

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: connectionEnv(extraEnv),
    encoding: "utf8",
    timeout: 30_000,
  });
}

function output(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`;
}

describe("loops CLI fail-closed connection (owner ruling 2026-09-04)", () => {
  test("data commands fail closed without API env or an explicit opt-in, creating no local store", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-fail-closed-list-"));
    try {
      const result = runCli(["list"], { LOOPS_DATA_DIR: dataDir });
      expect(result.status).not.toBe(0);
      const text = output(result);
      expect(text).toContain("no loops client connection is configured");
      expect(text).toContain(API_URL_KEY);
      expect(text).toContain(API_KEY_KEY);
      expect(text).toContain(`${CONNECTION_KEY}=file`);
      // Fail closed BEFORE any store opens: the data dir must stay untouched.
      expect(readdirSync(dataDir)).toEqual([]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("status fails closed the same way", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-fail-closed-status-"));
    try {
      const result = runCli(["status"], { LOOPS_DATA_DIR: dataDir });
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain("no loops client connection is configured");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("connection=api without both API variables is a hard error", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-fail-closed-api-"));
    try {
      const result = runCli(["list"], { LOOPS_DATA_DIR: dataDir, [CONNECTION_KEY]: "api" });
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain(`${CONNECTION_KEY}=api requires both ${API_URL_KEY} and ${API_KEY_KEY}`);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("explicit HASNA_LOOPS_CONNECTION=file still opens the local store (opt-in works)", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-fail-closed-optin-"));
    try {
      const result = runCli(["--json", "list"], {
        LOOPS_DATA_DIR: dataDir,
        [CONNECTION_KEY]: "file",
      });
      expect(result.status, output(result)).toBe(0);
      const value = JSON.parse(result.stdout) as unknown[];
      expect(Array.isArray(value)).toBe(true);
      expect(existsSync(join(dataDir, "loops.db"))).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
