import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertNoLegacyStorageMode, LEGACY_STORAGE_MODE_KEYS } from "./lib/retired-storage-mode.js";
import { getStorageBackend, getStorageConfig, getStorageStatus } from "./storage.js";
import { isolatedStoreEnv } from "./test-support/store-isolation.js";
import { getApiConfig, isApiMode, API_URL_ENV_KEYS, API_KEY_ENV_KEYS } from "./db/api-mode.js";

// ============================================================================
// Regression: a retired storage-mode variable must fail LOUDLY.
//
// MEASURED on the installed CLI at 0.14.69 (station01, clean `env -i`):
//
//   HASNA_MEMENTOS_STORAGE_MODE=local        mementos list --limit 1  -> rc=0, results
//   HASNA_MEMENTOS_STORAGE_MODE=wubbleflurp  mementos list --limit 1  -> rc=0, BYTE-IDENTICAL results
//
// The old selector machinery even mistranslated an UNKNOWN mode value into
// "unset" and silently served the local store. Deployment modes no longer
// exist (owner directive 2026-07-29; knowledge k_ms5wv466_u0jidq): the whole
// selector is RETIRED, and any STORAGE_MODE variable that is still SET — even
// to a valid-looking value, even blank — throws the fail-loud ratchet naming
// the variable. The client uses the local SQLite store or the HTTP API
// selected by HASNA_MEMENTOS_API_URL + HASNA_MEMENTOS_API_KEY; the server
// backend is sqlite|postgresql by HASNA_MEMENTOS_DATABASE_URL presence.
//
// EVERY rejection assertion below is paired with a POSITIVE CONTROL asserting
// the absence of a legacy variable still resolves. That pairing is not
// ceremony: the obvious wrong fix here is one that rejects everything, and a
// suite that only checked the rejection would pass green on a package that can
// no longer open any store.
//
// SAFETY: the in-process cases call `getStorageBackend()`/`getStorageConfig()`,
// which read env and the config file only — they open no database and make no
// network request. The CLI cases run `storage mode`, which is likewise inert,
// under `isolatedStoreEnv` so no ambient API credential can route a child at
// the shared production store.
// ============================================================================

const CANONICAL = "HASNA_MEMENTOS_STORAGE_MODE";

/** Values a caller can plausibly typo or inherit from a rename. */
const STALE_VALUES = ["cloud", "local", "remote", "hybrid", "wubbleflurp", "", "  "];

describe("retired storage mode — ANY set variable fails loud (in-process)", () => {
  const saved: Record<string, string | undefined> = {};

  test("POSITIVE CONTROL: no legacy variable set still resolves", () => {
    for (const k of [...LEGACY_STORAGE_MODE_KEYS, ...API_URL_ENV_KEYS, ...API_KEY_ENV_KEYS]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      expect(() => assertNoLegacyStorageMode()).not.toThrow();
      expect(getStorageBackend()).toBe("sqlite");
      expect(isApiMode()).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("a VALID-looking value (cloud) throws naming the variable — no value is valid anymore", () => {
    const saved = process.env[CANONICAL];
    process.env[CANONICAL] = "cloud";
    try {
      expect(() => assertNoLegacyStorageMode()).toThrow(/HASNA_MEMENTOS_STORAGE_MODE/);
      expect(() => getStorageBackend()).toThrow(/HASNA_MEMENTOS_STORAGE_MODE/);
      expect(() => getStorageConfig()).toThrow(/HASNA_MEMENTOS_STORAGE_MODE/);
      expect(() => getStorageStatus()).toThrow(/HASNA_MEMENTOS_STORAGE_MODE/);
    } finally {
      if (saved === undefined) delete process.env[CANONICAL];
      else process.env[CANONICAL] = saved;
    }
  });

  test("every stale value — including blank — throws naming the variable", () => {
    const saved = process.env[CANONICAL];
    try {
      for (const stale of STALE_VALUES) {
        process.env[CANONICAL] = stale;
        expect(() => assertNoLegacyStorageMode()).toThrow(/HASNA_MEMENTOS_STORAGE_MODE/);
      }
    } finally {
      if (saved === undefined) delete process.env[CANONICAL];
      else process.env[CANONICAL] = saved;
    }
  });

  test("the fallback env key fails loud too, and names ITSELF rather than the canonical key", () => {
    const saved = process.env["MEMENTOS_STORAGE_MODE"];
    process.env["MEMENTOS_STORAGE_MODE"] = "cloud";
    try {
      let message = "";
      try {
        assertNoLegacyStorageMode();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain("MEMENTOS_STORAGE_MODE");
    } finally {
      if (saved === undefined) delete process.env["MEMENTOS_STORAGE_MODE"];
      else process.env["MEMENTOS_STORAGE_MODE"] = saved;
    }
  });

  test("a complete API pair does not rescue a stale variable (ratchet runs first)", () => {
    const saved: Record<string, string | undefined> = {};
    for (const k of [...LEGACY_STORAGE_MODE_KEYS, "HASNA_MEMENTOS_API_URL", "HASNA_MEMENTOS_API_KEY"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      process.env["HASNA_MEMENTOS_API_URL"] = "https://mementos.hasna.xyz";
      process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
      process.env[CANONICAL] = "cloud";
      expect(() => isApiMode()).toThrow(/HASNA_MEMENTOS_STORAGE_MODE/);
      expect(() => getApiConfig()).toThrow(/HASNA_MEMENTOS_STORAGE_MODE/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// CLI level. The in-process tests prove the ratchet throws; only a spawned
// process proves the OPERATOR-VISIBLE contract the bug report measured — a
// NON-ZERO exit code. A thrown error that some CLI layer catches and turns back
// into rc=0 would leave the original defect fully intact.
// ---------------------------------------------------------------------------

const CLI_PATH = new URL("./cli/index.tsx", import.meta.url).pathname;
const DB_PATH = join(tmpdir(), `mementos-mode-validation-${Date.now()}.db`);

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) try { unlinkSync(f); } catch { /* already gone */ }
  }
});

beforeAll(async () => {
  // Attribution guard (2026-08-17): save refuses agent-source writes without a
  // resolved writing identity. The CLI spawns below carry MEMENTOS_AGENT=
  // test-agent, which must resolve in the temp DB for the WRITE-path cases to
  // reach the storage-mode rejection rather than the attribution guard.
  const reg = await runCli(null, ["register-agent", "test-agent"]);
  if (reg.exitCode !== 0) {
    throw new Error(`could not register test-agent: ${reg.stderr}`);
  }
});

async function runCli(
  legacyValue: string | null,
  argv: string[] = ["storage", "mode"],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const env = isolatedStoreEnv(DB_PATH, { extra: { MEMENTOS_AGENT: "test-agent" } });
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

describe("retired storage mode — CLI exit code", () => {
  test("POSITIVE CONTROL: no legacy variable set exits 0", async () => {
    const { exitCode } = await runCli(null);
    expect(exitCode).toBe(0);
  }, 30_000);

  test("a stale storage-mode value exits NON-ZERO and names the variable", async () => {
    const { exitCode, stdout, stderr } = await runCli("cloud");
    expect(exitCode).not.toBe(0);
    const output = `${stdout}${stderr}`;
    expect(output).toContain(CANONICAL);
  }, 30_000);

  test("the rejection reaches the actual READ path, not only the mode reporter", async () => {
    // `storage mode` is a diagnostic. Guarding only it would leave the defect
    // fully intact where it does damage: a read that silently answers from a
    // local store the caller never asked for. Measured pre-fix: `list` returned
    // rc=0 with real rows under HASNA_MEMENTOS_STORAGE_MODE=wubbleflurp.
    const { exitCode, stdout, stderr } = await runCli("wubbleflurp", ["list", "--limit", "1"]);
    expect(exitCode).not.toBe(0);
    expect(`${stdout}${stderr}`).toContain(CANONICAL);
  }, 30_000);

  test("the rejection reaches the actual WRITE path — the one that creates an invisible island", async () => {
    // The damaging case: a `save` under a stale mode succeeded into a local
    // SQLite file no other agent reads. It must refuse instead.
    const { exitCode, stdout, stderr } = await runCli("cloud", [
      "save",
      "regression-2004c965",
      "must not be written under a stale storage-mode variable",
    ]);
    expect(exitCode).not.toBe(0);
    expect(`${stdout}${stderr}`).toContain(CANONICAL);
  }, 30_000);

  test("POSITIVE CONTROL: the same read and write succeed with no legacy variable set", async () => {
    // Without this, the two assertions above would pass on a build where `list`
    // and `save` are simply broken for every env.
    const write = await runCli(null, [
      "save",
      "regression-2004c965-control",
      "written with no legacy variable set",
    ]);
    expect(write.exitCode).toBe(0);
    const read = await runCli(null, ["list", "--limit", "1"]);
    expect(read.exitCode).toBe(0);
  }, 45_000);

  test("--json reports the failure as JSON rather than printing nothing", async () => {
    const { exitCode, stdout } = await runCli("cloud", ["storage", "mode", "--json"]);
    expect(exitCode).not.toBe(0);
    expect(stdout.trim()).not.toBe("");
    const parsed = JSON.parse(stdout) as { ok?: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain(CANONICAL);
  }, 30_000);

  test("no stack trace is dumped for a configuration error", async () => {
    // `storage mode` is the command an operator runs *because* they are unsure
    // which store they are on. A Bun stack trace there buries the one line that
    // names the variable.
    const { stdout, stderr } = await runCli("cloud");
    const output = `${stdout}${stderr}`;
    expect(output).not.toContain("Bun v");
    expect(output).not.toContain("at getStorageMode");
  }, 30_000);
});
