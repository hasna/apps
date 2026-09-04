import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertClientStoreConfigured, DB_PATH_ENV_KEYS } from "../db/api-mode.js";
import { STORE_SELECTOR_ENV_KEYS } from "../test-support/store-isolation.js";

// ============================================================================
// Fail-closed store configuration (owner ruling 2026-09-04, fleet fail-closed
// wave): a mementos CLI run WITHOUT its API env (HASNA_MEMENTOS_API_URL +
// HASNA_MEMENTOS_API_KEY, aliases MEMENTOS_API_URL / MEMENTOS_API_KEY) must
// fail closed — non-zero exit + an actionable error naming the required env —
// and must NEVER silently serve the default on-box SQLite store
// (~/.hasna/mementos/mementos.db) with exit 0. Local mode is reachable only
// through the explicit opt-in env (HASNA_MEMENTOS_DB_PATH / MEMENTOS_DB_PATH).
//
// Two layers lock this in:
//   1. in-process: `assertClientStoreConfigured()` (src/db/api-mode.ts), the
//      gate the CLI preAction hook and getDatabase()'s default-path
//      fallthrough both call; and
//   2. end-to-end: a real CLI subprocess with a scrubbed environment exits
//      non-zero, names the required env, and creates no local database.
// ============================================================================

const ENV_KEYS_TO_CLEAR: readonly string[] = Array.from(
  new Set([
    ...STORE_SELECTOR_ENV_KEYS,
    ...DB_PATH_ENV_KEYS,
    "MEMENTOS_DB_SCOPE",
    "HASNA_DATA_HOME",
    "HASNA_CONFIG_HOME",
  ]),
);

describe("assertClientStoreConfigured — fail-closed store gate", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS_TO_CLEAR) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS_TO_CLEAR) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test("no API env and no explicit DB_PATH -> throws naming the required env", () => {
    let message = "";
    let code = "";
    try {
      assertClientStoreConfigured();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
      code = (e as { code?: string }).code ?? "";
    }
    expect(code).toBe("MEMENTOS_STORE_CONFIG");
    expect(message).toContain("HASNA_MEMENTOS_API_URL");
    expect(message).toContain("HASNA_MEMENTOS_API_KEY");
    expect(message).toContain("MEMENTOS_API_URL");
    expect(message).toContain("MEMENTOS_API_KEY");
    // The message must make the refusal explicit — this is never a fallback.
    expect(message).toContain("will NOT fall back");
    expect(message).toContain("~/.hasna/mementos/mementos.db");
    // And it must point at the explicit local opt-in.
    expect(message).toContain("HASNA_MEMENTOS_DB_PATH");
    expect(message).toContain("MEMENTOS_DB_PATH");
  });

  test("full API pair (HASNA_* prefix) -> configured, no throw", () => {
    process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
    process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
    expect(() => assertClientStoreConfigured()).not.toThrow();
  });

  test("full API pair via the MEMENTOS_* aliases -> configured, no throw", () => {
    process.env["MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
    process.env["MEMENTOS_API_KEY"] = "sk-test";
    expect(() => assertClientStoreConfigured()).not.toThrow();
  });

  test("explicit local opt-in (MEMENTOS_DB_PATH) alone -> configured, no throw", () => {
    process.env["MEMENTOS_DB_PATH"] = "/tmp/scratch-mementos.db";
    expect(() => assertClientStoreConfigured()).not.toThrow();
  });

  test("explicit local opt-in via HASNA_MEMENTOS_DB_PATH -> configured, no throw", () => {
    process.env["HASNA_MEMENTOS_DB_PATH"] = "/tmp/scratch-mementos.db";
    expect(() => assertClientStoreConfigured()).not.toThrow();
  });

  test("half an API pair still throws naming the missing variable", () => {
    process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
    let message = "";
    try {
      assertClientStoreConfigured();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("HASNA_MEMENTOS_API_KEY");
  });

  test("a retired storage-mode variable throws first, even with a full API pair", () => {
    process.env["HASNA_MEMENTOS_STORAGE_MODE"] = "";
    process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
    process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
    let message = "";
    try {
      assertClientStoreConfigured();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("HASNA_MEMENTOS_STORAGE_MODE");
  });
});

// ============================================================================
// End-to-end: the real CLI binary, in a real subprocess, with the store
// selectors scrubbed out of its environment (mirrors a station shell without
// the fleet credentials). NODE_ENV is removed too, because under `bun test`
// children inherit NODE_ENV=test; the fail-closed gate targets real operator
// invocations, and the test-scoped unpinned-open guard is asserted in
// src/db/database-unpinned-test-open-guard.test.ts.
// ============================================================================

const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;

function scrubbedCliEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of [...STORE_SELECTOR_ENV_KEYS, ...DB_PATH_ENV_KEYS, "NODE_ENV"]) {
    delete env[key];
  }
  delete env["MEMENTOS_DB_SCOPE"];
  return { ...env, ...extra };
}

async function runCli(
  args: string[],
  env: Record<string, string>,
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe("mementos CLI without store configuration fails closed", () => {
  test("FAILING INPUT: env-less `list` exits non-zero, names the env, creates no local db", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "mementos-failclosed-noenv-"));
    const dataHome = join(scratch, "data");
    const env = scrubbedCliEnv({ HASNA_DATA_HOME: dataHome });

    const { stdout, stderr, exitCode } = await runCli(["list", "--limit", "1"], env, scratch);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("HASNA_MEMENTOS_API_URL");
    expect(stderr).toContain("HASNA_MEMENTOS_API_KEY");
    expect(stderr).toContain("HASNA_MEMENTOS_DB_PATH");
    expect(stdout).toBe("");

    // No local SQLite file, no data directory, nothing created anywhere.
    expect(existsSync(join(dataHome, "mementos.db"))).toBe(false);
    expect(existsSync(dataHome)).toBe(false);
    expect(existsSync(join(scratch, ".mementos"))).toBe(false);
  });

  test("explicit local opt-in (MEMENTOS_DB_PATH) still works end-to-end", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "mementos-failclosed-optin-"));
    const dbPath = join(scratch, "opt-in", "mementos.db");
    const env = scrubbedCliEnv({ MEMENTOS_DB_PATH: dbPath });

    const { stdout, exitCode } = await runCli(["list", "--limit", "1", "--json"], env, scratch);

    expect(exitCode).toBe(0);
    expect(existsSync(dbPath)).toBe(true);
    const parsed = JSON.parse(stdout) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("--version and --help stay usable without any store configuration", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "mementos-failclosed-help-"));
    const env = scrubbedCliEnv();

    const version = await runCli(["--version"], env, scratch);
    expect(version.exitCode).toBe(0);

    const help = await runCli(["--help"], env, scratch);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage");
  });

  test("`storage mode` (the diagnostic probe) still runs without configuration", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "mementos-failclosed-mode-"));
    const env = scrubbedCliEnv();

    const { stdout, exitCode } = await runCli(["storage", "mode", "--json"], env, scratch);
    expect(exitCode).toBe(0);
    const report = JSON.parse(stdout) as { schema?: string };
    expect(report.schema).toBe("mementos.store_backend.v1");
  });

  test("control: a full API pair passes the gate (transport failures stay separate)", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "mementos-failclosed-apimode-"));
    // Loopback with a closed port: the store gate must PASS (API mode is
    // configured), so the failure that follows is a transport failure, never
    // the "not configured" refusal.
    const env = scrubbedCliEnv({
      HASNA_MEMENTOS_API_URL: "http://127.0.0.1:1",
      HASNA_MEMENTOS_API_KEY: "stub-key-not-a-secret",
    });

    const { stderr, exitCode } = await runCli(["list", "--limit", "1"], env, scratch);

    expect(stderr).not.toContain("will NOT fall back");
    expect(stderr).not.toContain("HASNA_MEMENTOS_DB_PATH");
    expect(exitCode).not.toBe(0); // the request itself failed — not a refusal
  });
});
