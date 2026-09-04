import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Fail-closed CLI behavior (owner ruling 2026-09-04 — never a silent local
 * fallback):
 *
 *  1. With NO API env configured at all, a store-backed command fails closed
 *     (non-zero exit, error naming HASNA_SHORTLINKS_API_URL /
 *     HASNA_SHORTLINKS_API_KEY) and creates no local database —
 *     ~/.hasna/shortlinks/shortlinks.db is never opened or created by default.
 *  2. A partially configured pair (URL without key, or key without URL) fails
 *     closed naming both members — never defaults to local mode.
 *  3. `--json` mode reports the same refusal as a parseable JSON error with a
 *     non-zero exit (never a false-green exit 0 local-fallback event).
 *  4. Local mode works only under an EXPLICIT opt-in: SHORTLINKS_LOCAL=1 or
 *     the --db <path> flag.
 *
 * Unlike `cli.test.ts` these tests deliberately do NOT pass `--db` by default
 * and DO strip every fleet/local env key, so the process under test really has
 * no backend configuration unless the test says so.
 */

/** Env keys stripped from the spawned CLI so the case under test is truly "no env". */
const STRIP_ENV_KEYS = [
  "HASNA_SHORTLINKS_API_URL",
  "HASNA_SHORTLINKS_API_KEY",
  "SHORTLINKS_API_URL",
  "SHORTLINKS_API_KEY",
  "HASNA_SHORTLINKS_DATABASE_URL",
  "SHORTLINKS_DATABASE_URL",
  "SHORTLINKS_LOCAL",
  "SHORTLINKS_DB",
  "SHORTLINKS_CLICK_SALT",
];

let tempHome = "";
let dbPath = "";

interface RunOptions {
  env?: Record<string, string>;
  json?: boolean;
  /** Pass the root --db <path> flag (an explicit local opt-in). */
  db?: boolean;
  /** Set SHORTLINKS_LOCAL=1 (an explicit local opt-in). */
  local?: boolean;
}

function runCli(args: string[], options: RunOptions = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STRIP_ENV_KEYS.includes(key)) env[key] = value;
  }
  env.HOME = tempHome;
  env.SHORTLINKS_HOME = tempHome;
  if (options.local) env.SHORTLINKS_LOCAL = "1";
  Object.assign(env, options.env);
  const cmd = [
    process.execPath,
    "src/cli/index.ts",
    ...(options.db === false ? [] : ["--db", dbPath]),
    ...(options.json === false ? [] : ["--json"]),
    ...args,
  ];
  return Bun.spawnSync({
    cmd,
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

const output = (result: { stdout: Buffer; stderr: Buffer }): string =>
  `${result.stdout.toString()}\n${result.stderr.toString()}`;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "shortlinks-failclosed-"));
  dbPath = join(tempHome, "shortlinks.db");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe("fail closed without the fleet API env", () => {
  test("no API env: a store-backed command fails closed and creates no local database", () => {
    const result = runCli(["init", "--domain", "has.na"], { db: false });
    expect(result.exitCode).toBe(1);
    const text = output(result);
    // Actionable error names the required fleet API env — never a silent
    // local fallback, never a false-green exit 0.
    expect(text).toMatch(/HASNA_SHORTLINKS_API_URL/);
    expect(text).toMatch(/HASNA_SHORTLINKS_API_KEY/);
    expect(text).toMatch(/never falls back to local storage/);
    expect(text).not.toMatch(/local-fallback/);
    // The no-env run must create no on-box SQLite database and no config.
    expect(existsSync(join(tempHome, "shortlinks.db"))).toBe(false);
    expect(existsSync(join(tempHome, "config.json"))).toBe(false);
  });

  test("no API env: --json mode fails closed with a parseable error naming the required env", () => {
    const result = runCli(["doctor"], { db: false });
    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout.toString()) as { error: string };
    expect(payload.error).toContain("HASNA_SHORTLINKS_API_URL");
    expect(payload.error).toContain("HASNA_SHORTLINKS_API_KEY");
    expect(payload.error).not.toContain("local-fallback");
    expect(existsSync(join(tempHome, "shortlinks.db"))).toBe(false);
  });

  test("no API env: human mode fails closed without a false-green local fallback event", () => {
    const result = runCli(["link", "list"], { db: false, json: false });
    expect(result.exitCode).toBe(1);
    const text = output(result);
    expect(text).toMatch(/HASNA_SHORTLINKS_API_URL/);
    expect(text).not.toMatch(/local-fallback/);
    expect(existsSync(join(tempHome, "shortlinks.db"))).toBe(false);
  });

  test("partial API env fails closed naming both keys — never defaults to local mode", () => {
    // URL without key: the pair is incomplete, so the CLI must not open local
    // mode or guess a credential.
    const urlOnly = runCli(["init", "--domain", "has.na"], {
      db: false,
      env: { HASNA_SHORTLINKS_API_URL: "https://shortlinks.example.test" },
    });
    expect(urlOnly.exitCode).toBe(1);
    expect(output(urlOnly)).toMatch(/HASNA_SHORTLINKS_API_KEY/);

    // Key without URL: same refusal from the other side.
    const keyOnly = runCli(["init", "--domain", "has.na"], {
      db: false,
      env: { HASNA_SHORTLINKS_API_KEY: "fixture-key" },
    });
    expect(keyOnly.exitCode).toBe(1);
    expect(output(keyOnly)).toMatch(/HASNA_SHORTLINKS_API_URL/);

    // Neither run may create local storage.
    expect(existsSync(join(tempHome, "shortlinks.db"))).toBe(false);
  });
});

describe("explicit local opt-in still works", () => {
  test("SHORTLINKS_LOCAL=1 opts into the on-box SQLite store without --db", () => {
    const init = runCli(["init", "--domain", "has.na"], { db: false, local: true });
    expect(init.exitCode).toBe(0);
    const initJson = JSON.parse(init.stdout.toString()) as { store: string; config: { defaultDomain: string } };
    expect(initJson.store).toBe("local");
    expect(initJson.config.defaultDomain).toBe("has.na");

    const doctor = runCli(["doctor"], { db: false, local: true });
    expect(doctor.exitCode).toBe(0);
    const doctorJson = JSON.parse(doctor.stdout.toString()) as { store: string; ok: boolean };
    expect(doctorJson.ok).toBe(true);
    expect(doctorJson.store).toBe("local");

    // The opt-in really writes the on-box database.
    expect(existsSync(join(tempHome, "shortlinks.db"))).toBe(true);
  });

  test("--db <path> opts into the on-box SQLite store without SHORTLINKS_LOCAL", () => {
    const init = runCli(["init", "--domain", "has.na"], { db: true });
    expect(init.exitCode).toBe(0);
    const initJson = JSON.parse(init.stdout.toString()) as { store: string };
    expect(initJson.store).toBe("local");
    expect(existsSync(dbPath)).toBe(true);
  });
});
