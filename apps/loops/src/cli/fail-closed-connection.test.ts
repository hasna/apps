import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

const API_URL_KEY = "HASNA_LOOPS_API_URL";
const API_KEY_KEY = "HASNA_LOOPS_API_KEY";
const LOCAL_KEY = "HASNA_LOOPS_LOCAL";
const LOCAL_ALIAS = "LOOPS_LOCAL";
const RETIRED_CONNECTION_KEY = "HASNA_LOOPS_CONNECTION";
const SCRUBBED = new Set([API_URL_KEY, API_KEY_KEY, LOCAL_KEY, LOCAL_ALIAS, RETIRED_CONNECTION_KEY]);
const HOSTED_ENV = { [API_URL_KEY]: "https://loops.example.invalid", [API_KEY_KEY]: "test-key-not-a-real-secret" } as const;

/**
 * Spawn env with the loops connection variables fully removed/blanked, so a
 * developer's own HASNA_LOOPS_API_URL/KEY or local opt-in can never leak into
 * the fail-closed assertions. `extra` re-adds specific variables per test.
 */
function connectionEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SCRUBBED.has(key)) continue;
    env[key] = value;
  }
  return {
    ...env,
    [API_URL_KEY]: "",
    [API_KEY_KEY]: "",
    [LOCAL_KEY]: "",
    [LOCAL_ALIAS]: "",
    [RETIRED_CONNECTION_KEY]: "",
    // Keychain tier pin (see cli/index.test.ts): the resolver's account is
    // HASNA_STATION, else the short hostname, else USER — a real macOS
    // keychain item under this machine's own account would satisfy the
    // blanked connection env. A sentinel no item uses keeps the tier a miss
    // on every machine. Per-test overrides still win (spread last).
    HASNA_STATION: "loops-hermetic-no-such-station",
    NO_COLOR: "1",
    ...extra,
  };
}

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  // Ambient credential isolation: the child env is a scrubbed copy of the
  // live process.env, so a provisioned station's real
  // ~/.hasna/loops/config/credentials outranks the blanked connection env and
  // REFUSES the fail-closed assertions as "different service authorities"
  // (green on CI, red on the station). Anchor the home-layout roots at a
  // scratch dir — no credentials file can exist there — so the disk tier
  // consults nothing on both kinds of machine.
  const scratch = mkdtempSync(join(tmpdir(), "loops-fail-closed-home-"));
  try {
    return spawnSync(process.execPath, ["--no-env-file", cliPath, ...args], {
      env: connectionEnv({
        ...extraEnv,
        HOME: scratch,
        HASNA_HOME: scratch,
        HASNA_CONFIG_HOME: scratch,
      }),
      encoding: "utf8",
      timeout: 30_000,
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function output(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`;
}

function withDataDir<T>(label: string, fn: (dataDir: string) => T): T {
  const dataDir = mkdtempSync(join(tmpdir(), `loops-fail-closed-${label}-`));
  try {
    return fn(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

describe("loops CLI fail-closed connection (owner rulings 2026-09-04 / 2026-09-07)", () => {
  test("data commands fail closed without API env or an explicit opt-in, creating no local store", () => {
    withDataDir("list", (dataDir) => {
      const result = runCli(["list"], { LOOPS_DATA_DIR: dataDir });
      expect(result.status).not.toBe(0);
      const text = output(result);
      expect(text).toContain("no loops client connection is configured");
      expect(text).toContain(API_URL_KEY);
      expect(text).toContain(API_KEY_KEY);
      expect(text).toContain("hasna.credentials.loops.api-key");
      expect(text).toContain(`${LOCAL_KEY}=1`);
      // Fail closed BEFORE any store opens: the data dir must stay untouched.
      expect(readdirSync(dataDir)).toEqual([]);
    });
  });

  test("status fails closed the same way", () => {
    withDataDir("status", (dataDir) => {
      const result = runCli(["status"], { LOOPS_DATA_DIR: dataDir });
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain("no loops client connection is configured");
      expect(readdirSync(dataDir)).toEqual([]);
    });
  });

  test("FAILING INPUT (0.7.0 opened SQLite here): a bare-store command fails closed with nothing configured, creating no local store", () => {
    // `export` constructed `new Store()` with no guard at all on 0.7.0 — the
    // process-wide choke point now refuses the open with the resolver's own
    // one-line fail-closed message.
    withDataDir("export", (dataDir) => {
      const result = runCli(["export", "--dry-run"], { LOOPS_DATA_DIR: dataDir });
      expect(result.status).not.toBe(0);
      const text = output(result);
      expect(text).toContain("no loops client connection is configured");
      expect(text).toContain(`${LOCAL_KEY}=1`);
      expect(text).not.toMatch(/^\s+at /m);
      expect(readdirSync(dataDir)).toEqual([]);
    });
  });

  test("a bare-store command on the HOSTED route is REMOTE_COMMAND_UNSUPPORTED and opens nothing", () => {
    withDataDir("export-hosted", (dataDir) => {
      const result = runCli(["export", "--dry-run"], { LOOPS_DATA_DIR: dataDir, ...HOSTED_ENV });
      expect(result.status).not.toBe(0);
      const text = output(result);
      expect(text).toContain("REMOTE_COMMAND_UNSUPPORTED");
      expect(text).toContain(`${LOCAL_KEY}=1`);
      expect(text).not.toContain("test-key-not-a-real-secret");
      expect(readdirSync(dataDir)).toEqual([]);
    });
  });

  test("a guarded local-only command on the HOSTED route is REMOTE_COMMAND_UNSUPPORTED naming the command, with no store", () => {
    withDataDir("daemon-status-hosted", (dataDir) => {
      const result = runCli(["--json", "daemon", "status"], { LOOPS_DATA_DIR: dataDir, ...HOSTED_ENV });
      expect(result.status).not.toBe(0);
      const text = output(result);
      expect(text).toContain("REMOTE_COMMAND_UNSUPPORTED");
      expect(text).toContain("loops daemon status");
      expect(text).not.toContain("test-key-not-a-real-secret");
      expect(readdirSync(dataDir)).toEqual([]);
    });
  });

  test("connection=api is retired: the shared resolver selects the hosted API", () => {
    withDataDir("api", (dataDir) => {
      const result = runCli(["list"], { LOOPS_DATA_DIR: dataDir, [RETIRED_CONNECTION_KEY]: "api" });
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain(`${RETIRED_CONNECTION_KEY}=api is retired`);
      expect(output(result)).toContain(API_KEY_KEY);
      // Fail closed BEFORE any store opens: the data dir must stay untouched.
      expect(readdirSync(dataDir)).toEqual([]);
    });
  });

  test("FAILING INPUT: the retired HASNA_LOOPS_CONNECTION=file selector is refused with the migration hint and opens nothing", () => {
    withDataDir("retired-file", (dataDir) => {
      for (const args of [["--json", "list"], ["export", "--dry-run"], ["daemon", "status"]]) {
        const result = runCli(args, { LOOPS_DATA_DIR: dataDir, [RETIRED_CONNECTION_KEY]: "file" });
        expect(result.status, JSON.stringify(args)).not.toBe(0);
        const text = output(result);
        expect(text).toContain(`${RETIRED_CONNECTION_KEY}=file is retired`);
        expect(text).toContain(`${LOCAL_KEY}=1`);
        expect(readdirSync(dataDir)).toEqual([]);
      }
    });
  });

  test("explicit HASNA_LOOPS_LOCAL=1 opens the local store and announces LOCAL mode once (opt-in works)", () => {
    withDataDir("optin", (dataDir) => {
      const result = runCli(["--json", "list"], { LOOPS_DATA_DIR: dataDir, [LOCAL_KEY]: "1" });
      expect(result.status, output(result)).toBe(0);
      const value = JSON.parse(result.stdout) as unknown[];
      expect(Array.isArray(value)).toBe(true);
      expect(existsSync(join(dataDir, "loops.db"))).toBe(true);
      expect(result.stderr.match(/loops: LOCAL mode/g)?.length ?? 0).toBe(1);
      expect(result.stderr).toContain(LOCAL_KEY);
    });
  });

  test("the unprefixed alias LOOPS_LOCAL=1 selects the same route", () => {
    withDataDir("alias", (dataDir) => {
      const result = runCli(["--json", "list"], { LOOPS_DATA_DIR: dataDir, [LOCAL_ALIAS]: "1" });
      expect(result.status, output(result)).toBe(0);
      expect(existsSync(join(dataDir, "loops.db"))).toBe(true);
    });
  });

  test("a configured environment outranks the opt-in: a bare-store command with both refuses on the hosted route", () => {
    withDataDir("outranked", (dataDir) => {
      const result = runCli(["export", "--dry-run"], { LOOPS_DATA_DIR: dataDir, [LOCAL_KEY]: "1", ...HOSTED_ENV });
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain("REMOTE_COMMAND_UNSUPPORTED");
      expect(readdirSync(dataDir)).toEqual([]);
    });
  });
});
