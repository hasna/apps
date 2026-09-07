/**
 * @hasna/logs — Every command, every transport (owner directive 2026-08-15,
 * storage-mode axis retired).
 *
 * A CLI command with NO fleet credential must run against the on-box SQLite
 * store — local is the default transport, not an error, and definitely not a
 * guard. `HASNA_LOGS_LOCAL=1` (alias `LOGS_LOCAL=1`) forces local even when a
 * credential resolves, and a run that lands on local says "local" once on
 * stderr — it is never silent. The raw-store maintenance family (`db doctor
 * *`) runs identically on both transports. Legacy `*_MODE` selectors are
 * inert: they never select a transport and never gate a command. A DECLARED
 * but un-honourable authority (URL without a key, blank variable, disagreeing
 * aliases) still fails loud as a misconfiguration — it is never silently
 * routed to the local store.
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
      HASNA_LOGS_API_KEY_OVERRIDE: undefined,
      HASNA_LOGS_API_KEY_REF: undefined,
      HASNA_PROFILE: undefined,
      HASNA_LOGS_STORAGE_MODE: undefined,
      HASNA_LOGS_MODE: undefined,
      LOGS_STORAGE_MODE: undefined,
      LOGS_MODE: undefined,
      HASNA_LOGS_LOCAL: undefined,
      LOGS_LOCAL: undefined,
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
    let entries: import("node:fs").Dirent[];
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

describe("logs CLI — every command works on every transport", () => {
  test("no credential + no opt-in: the local store is the default (exit 0, local line, db created)", () => {
    const home = mkdtempSync(join(tmpdir(), "logs-everytransport-"));
    try {
      const dbPath = join(home, "logs.db");
      const result = runCli(["list", "--limit", "1"], {
        HOME: home,
        HASNA_LOGS_DATA_DIR: home,
        HASNA_LOGS_DB_PATH: dbPath,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("0 log(s)");
      // The local store announces itself once on stderr; it is never silent.
      expect(result.stderr).toMatch(/local store/);
      // The default local store is the one created — at the temp path.
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("raw-store maintenance commands run on the local store without a credential and without an opt-in", () => {
    const home = mkdtempSync(join(tmpdir(), "logs-everytransport-doctor-"));
    try {
      const result = runCli(["doctor", "segments"], {
        HOME: home,
        HASNA_LOGS_DATA_DIR: home,
        HASNA_LOGS_DB_PATH: join(home, "logs.db"),
      });

      // The command RUNS — it is not transport-gated.
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Raw event store: ok/);
      expect(result.stderr).not.toMatch(/local-only operation/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("explicit HASNA_LOGS_LOCAL=1 opt-in forces local and says so on stderr", () => {
    const home = mkdtempSync(join(tmpdir(), "logs-everytransport-optin-"));
    try {
      const dbPath = join(home, "logs.db");
      const result = runCli(["list", "--limit", "1"], {
        HOME: home,
        HASNA_LOGS_DATA_DIR: home,
        HASNA_LOGS_DB_PATH: dbPath,
        HASNA_LOGS_LOCAL: "1",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/local store/);
      expect(result.stdout).toContain("0 log(s)");
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("legacy storage-mode selectors are inert: they never select a transport and never gate a command", () => {
    const home = mkdtempSync(join(tmpdir(), "logs-everytransport-mode-"));
    try {
      // A stale fragment that still exports a *_MODE selector must not flip
      // the transport nor block the command: with no credential the local
      // default serves the read.
      const result = runCli(["list", "--limit", "1"], {
        HOME: home,
        HASNA_LOGS_DATA_DIR: home,
        HASNA_LOGS_DB_PATH: join(home, "logs.db"),
        HASNA_LOGS_STORAGE_MODE: "self_hosted",
        HASNA_LOGS_MODE: "local",
        LOGS_STORAGE_MODE: "cloud",
        LOGS_MODE: "local",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("0 log(s)");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a declared authority that cannot be honoured fails loud and never routes to local", () => {
    const home = mkdtempSync(join(tmpdir(), "logs-everytransport-misconfig-"));
    try {
      // A URL without a key is a misconfiguration, not a transport choice —
      // the command fails with an actionable error and creates NO local db.
      const result = runCli(["list", "--limit", "1"], {
        HOME: home,
        HASNA_LOGS_DATA_DIR: home,
        HASNA_LOGS_DB_PATH: join(home, "logs.db"),
        HASNA_LOGS_API_URL: "https://logs.example.test/v1",
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/HASNA_LOGS_API_URL/);
      expect(result.stderr).not.toMatch(/LocalStore/i);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});