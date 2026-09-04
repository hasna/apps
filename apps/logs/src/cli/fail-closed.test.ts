/**
 * @hasna/logs — Fail-closed regression (owner ruling 2026-09-04).
 *
 * Running the CLI WITHOUT the fleet API env (HASNA_LOGS_API_URL /
 * HASNA_LOGS_API_KEY, aliases LOGS_API_URL/LOGS_API_KEY) must FAIL CLOSED:
 * non-zero exit + an actionable error naming the required env — never a
 * silent fallback to the local SQLite store (~/.hasna/logs/logs.db), never a
 * false-green exit 0. Local mode is reachable only through the EXPLICIT
 * opt-in HASNA_LOGS_LOCAL=1 (alias LOGS_LOCAL=1).
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function runCli(
  args: string[],
  env: Record<string, string | undefined>,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["src/cli/index.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HASNA_LOGS_API_URL: undefined,
      HASNA_LOGS_API_KEY: undefined,
      LOGS_API_URL: undefined,
      LOGS_API_KEY: undefined,
      HASNA_LOGS_STORAGE_MODE: undefined,
      ...env,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function dbFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    let entries: string[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".db") || entry.name.endsWith(".sqlite")) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

describe("logs CLI fails closed without the fleet API env", () => {
  test("data-plane command exits non-zero with an actionable error and creates NO local db", () => {
    const home = mkdtempSync(join(tmpdir(), "logs-fail-closed-"));
    try {
      const result = runCli(["list", "--limit", "1"], {
        HOME: home,
        HASNA_LOGS_DATA_DIR: home,
        HASNA_LOGS_DB_PATH: join(home, "logs.db"),
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/HASNA_LOGS_API_URL/);
      expect(result.stderr).toMatch(/HASNA_LOGS_API_KEY/);
      expect(result.stderr).toMatch(/HASNA_LOGS_LOCAL/);
      expect(result.stderr).not.toMatch(/LocalStore/i);
      // The failure is a refusal, not a crash: no stack trace.
      expect(result.stderr).not.toContain("at ");
      // No SQLite file anywhere under the temp HOME — no silent local store.
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("local-only commands also fail closed without the explicit opt-in", () => {
    const home = mkdtempSync(join(tmpdir(), "logs-fail-closed-"));
    try {
      const result = runCli(["doctor", "segments"], {
        HOME: home,
        HASNA_LOGS_DATA_DIR: home,
        HASNA_LOGS_DB_PATH: join(home, "logs.db"),
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/local-only operation/);
      expect(result.stderr).toMatch(/HASNA_LOGS_LOCAL/);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("explicit HASNA_LOGS_LOCAL=1 opt-in restores local mode", () => {
    const home = mkdtempSync(join(tmpdir(), "logs-fail-closed-optin-"));
    try {
      const dbPath = join(home, "logs.db");
      const result = runCli(["list", "--limit", "1"], {
        HOME: home,
        HASNA_LOGS_DATA_DIR: home,
        HASNA_LOGS_DB_PATH: dbPath,
        HASNA_LOGS_LOCAL: "1",
      });

      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout).toContain("0 log(s)");
      // The explicit local store is the one created — at the temp path.
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
