import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getStorageBackend, getStorageConfig, getStorageStatus } from "./storage.js";
import { isolatedStoreEnv } from "./test-support/store-isolation.js";
import { getApiConfig, isApiMode, API_URL_ENV_KEYS, API_KEY_ENV_KEYS } from "./db/api-mode.js";
import { REMOVED_MEMENTOS_MODE_ENV_KEYS } from "./lib/local-opt-in.js";

// ============================================================================
// Regression: a retired storage-mode variable is INERT.
//
// MEASURED on the installed CLI at 0.14.69 (station01, clean `env -i`):
//
//   HASNA_MEMENTOS_STORAGE_MODE=local        mementos list --limit 1  -> rc=0, results
//   HASNA_MEMENTOS_STORAGE_MODE=wubbleflurp  mementos list --limit 1  -> rc=0, BYTE-IDENTICAL results
//
// The old selector machinery even mistranslated an UNKNOWN mode value into
// "unset" and silently served the local store. Deployment modes no longer
// exist (owner directive 2026-07-29; knowledge k_ms5wv466_u0jidq): the whole
// selector was RETIRED — first as a fail-loud ratchet, and with the resolver
// adoption (2026-09-04, hasna/apps#1720) the ratchet itself was STRIPPED:
// nothing reads `*_MODE` / `*_STORAGE_MODE`, a stale variable can neither
// select a transport nor throw. The client transport is decided by what the
// @hasna/contracts chain RESOLVES against the deliberate local opt-ins; the
// server backend is sqlite|postgresql by HASNA_MEMENTOS_DATABASE_URL presence.
//
// EVERY inertness assertion below is paired with a POSITIVE CONTROL. That
// pairing is not ceremony: the obvious wrong fix here is one that rejects
// everything, and a suite that only checked the old rejection would pass green
// on a package that can no longer open any store.
//
// SAFETY: the in-process cases call `getStorageBackend()`/`getStorageConfig()`,
// which read env and the config file only — they open no database and make no
// network request. The CLI cases run `storage mode` / `list` / `save`, under
// `isolatedStoreEnv` so no ambient API credential can route a child at the
// shared production store.
// ============================================================================

const CANONICAL = "HASNA_MEMENTOS_STORAGE_MODE";

/** Values a caller can plausibly typo or inherit from a rename. */
const STALE_VALUES = ["cloud", "local", "remote", "hybrid", "wubbleflurp", "", "  "];

describe("retired storage mode — any set variable is INERT (in-process)", () => {
  const saved: Record<string, string | undefined> = {};

  test("POSITIVE CONTROL: no legacy variable set still resolves", () => {
    for (const k of [...REMOVED_MEMENTOS_MODE_ENV_KEYS, ...API_URL_ENV_KEYS, ...API_KEY_ENV_KEYS]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      expect(getStorageBackend()).toBe("sqlite");
      expect(isApiMode()).toBe(false);
      expect(getApiConfig()).toBeNull();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("a VALID-looking value (cloud) is inert — it neither throws nor selects anything", () => {
    const saved = process.env[CANONICAL];
    process.env[CANONICAL] = "cloud";
    try {
      expect(getStorageBackend()).toBe("sqlite");
      expect(isApiMode()).toBe(false);
      expect(() => getStorageConfig()).not.toThrow();
      expect(() => getStorageStatus()).not.toThrow();
    } finally {
      if (saved === undefined) delete process.env[CANONICAL];
      else process.env[CANONICAL] = saved;
    }
  });

  test("every stale value — including blank — is inert", () => {
    const saved = process.env[CANONICAL];
    try {
      for (const stale of STALE_VALUES) {
        process.env[CANONICAL] = stale;
        expect(() => getStorageBackend()).not.toThrow();
        expect(() => isApiMode()).not.toThrow();
      }
    } finally {
      if (saved === undefined) delete process.env[CANONICAL];
      else process.env[CANONICAL] = saved;
    }
  });

  test("the fallback env key is inert too", () => {
    const saved = process.env["MEMENTOS_STORAGE_MODE"];
    process.env["MEMENTOS_STORAGE_MODE"] = "cloud";
    try {
      expect(getStorageBackend()).toBe("sqlite");
      expect(isApiMode()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env["MEMENTOS_STORAGE_MODE"];
      else process.env["MEMENTOS_STORAGE_MODE"] = saved;
    }
  });

  test("a complete API pair still resolves with a stale variable present", () => {
    const saved: Record<string, string | undefined> = {};
    for (const k of [...REMOVED_MEMENTOS_MODE_ENV_KEYS, "HASNA_MEMENTOS_API_URL", "HASNA_MEMENTOS_API_KEY"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
      process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
      process.env[CANONICAL] = "cloud";
      expect(isApiMode()).toBe(true);
      expect(getApiConfig()?.baseUrl).toBe("https://mementos.hasna.xyz/v1");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// CLI level. The in-process tests prove the variables are inert; only a
// spawned process proves the OPERATOR-VISIBLE contract: a stale storage-mode
// variable must not change the exit code, the store, or the output of a run
// (the measured 0.14.69 defect was rc=0 with BYTE-IDENTICAL results — the
// variables simply must not be read).
// ---------------------------------------------------------------------------

const CLI_PATH = new URL("./cli/index.tsx", import.meta.url).pathname;
const DB_PATH = join(tmpdir(), `mementos-mode-inert-${Date.now()}.db`);

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) try { unlinkSync(f); } catch { /* already gone */ }
  }
});

async function runCli(
  legacyValue: string | null,
  argv: string[] = ["storage", "mode"],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const env = isolatedStoreEnv(DB_PATH, {
    // save attributes agent-source writes to the writing agent, resolved from
    // MEMENTOS_AGENT when --agent is omitted; declare the identity so the
    // positive-control save resolves on CI, which has no agent-id file.
    extra: { MEMENTOS_AGENT: "e2e-test-agent" },
  });
  if (legacyValue !== null) env[CANONICAL] = legacyValue;
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...argv], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("retired storage mode — CLI ignores stale variables", () => {
  test("POSITIVE CONTROL: no legacy variable set exits 0", async () => {
    const { exitCode } = await runCli(null);
    expect(exitCode).toBe(0);
  }, 30_000);

  test("a stale storage-mode value exits 0 exactly like its absence", async () => {
    const plain = await runCli(null);
    const stale = await runCli("cloud");
    expect(stale.exitCode).toBe(0);
    expect(stale.stdout).toBe(plain.stdout);
  }, 30_000);

  test("the READ path is unaffected by a stale value — same rows, same rc", async () => {
    const { exitCode, stdout, stderr } = await runCli("wubbleflurp", [
      "save",
      "regression-2004c965",
      "written under a stale storage-mode variable",
    ]);
    expect(exitCode).toBe(0);
    expect(`${stdout}${stderr}`).not.toContain(CANONICAL);
    const read = await runCli("wubbleflurp", ["list", "--limit", "1"]);
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toContain("written under a stale storage-mode variable");
  }, 45_000);

  test("the WRITE path is unaffected by a stale value", async () => {
    // The damaging pre-fix shape was a save that either went to the wrong store
    // or refused; a stale variable must not move it at all.
    const write = await runCli("cloud", [
      "save",
      "regression-2004c965-write",
      "written with a stale storage-mode variable set",
    ]);
    expect(write.exitCode).toBe(0);
    expect(`${write.stdout}${write.stderr}`).not.toContain(CANONICAL);
  }, 45_000);

  test("POSITIVE CONTROL: the same read and write succeed with no legacy variable set", async () => {
    const write = await runCli(null, [
      "save",
      "regression-2004c965-control",
      "written with no legacy variable set",
    ]);
    expect(write.exitCode).toBe(0);
    const read = await runCli(null, ["list", "--limit", "1"]);
    expect(read.exitCode).toBe(0);
  }, 45_000);
});