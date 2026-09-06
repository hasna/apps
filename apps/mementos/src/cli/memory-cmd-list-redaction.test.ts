import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { runRedactionCli } from "../test-support/redaction-cli.js";
import {
  assertLocalStoreBackend,
  blankLlmProviderEnv,
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";

// ============================================================================
// Regression: `mementos list` rendered raw memory values and credential-shaped
// KEYS to stdout in every format (JSON, YAML, CSV, compact).
//
// The write path (src/db/memories.ts createMemory / bulkUpsertMemories /
// updateMemory) passes `value` and `summary` through redactSecrets, but NEVER
// the `key`. A credential-shaped key therefore survives any write path and
// leaks on every read. redactSecrets is only reached on WRITE paths — the read
// path (parseMemoryRow -> outputJson / outputYaml / CSV row / formatMemoryLine)
// emits the raw row unchanged, which is exactly the incident: secret detectors
// fired on `mementos list` stdout (package_registry_token on `npm_`,
// AWS-access-key-id on `AKIA`).
//
// The fixture keys are chosen to trigger BOTH the incident detectors AND the
// read-path redactor's own patterns, so the test is deterministic in both
// directions: they leak on the unfixed build and are redacted to [REDACTED]
// on the fixed one.
//
// The leak is POPULATION-dependent, not format-dependent: compact list defaults
// to a 20-row page, so a fixture-scale test can pass while a full-population
// compact read (with a token row beyond the page cut) still leaks. That is why
// a full-population compact-projection case is required below.
// ============================================================================

// Built by concatenation (repo convention, see src/lib/redact.test.ts) so no
// literal secret-shaped string sits in source — the runtime values still match
// the incident detectors and the redactor, which is what the test needs.
const AWS_ACCESS_KEY = "AK" + "IAIOSFODNN7EXAMPLE"; // AKIA + 16 chars (canonical AWS example access key)
const NPM_REGISTRY_TOKEN = "npm" + "_" + "a".repeat(36); // npm_ + 36 chars

const ORDINARY_KEY = "ordinary-key";
const ORDINARY_VALUE = "ordinary value that must survive";

const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;

async function runCli(
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runRedactionCli(CLI_PATH, env, args);
}

interface SeedRow {
  id: string;
  key: string;
  value: string;
  category?: string;
  scope?: string;
  importance?: number;
}

/** Insert rows straight into the isolated SQLite file (bypasses write-side
 *  redaction, exactly the population that reproduces the read leak). */
function seedRows(dbPath: string, rows: SeedRow[]): void {
  const db = new Database(dbPath);
  try {
    const insert = db.prepare(`
      INSERT INTO memories (id, key, value, category, scope, summary, tags, importance, source, status, pinned, metadata, access_count, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, '[]', ?, 'agent', 'active', 0, '{}', 0, 1, datetime('now'), datetime('now'))
    `);
    db.run("BEGIN");
    for (const r of rows) {
      insert.run(
        r.id,
        r.key,
        r.value,
        r.category ?? "fact",
        r.scope ?? "private",
        r.importance ?? 5,
      );
    }
    db.run("COMMIT");
  } finally {
    db.close();
  }
}

/** Fresh isolated local store + a CLI run that triggers schema creation. */
async function makeStore(): Promise<{ dbPath: string; env: Record<string, string> }> {
  const dbPath = join(
    tmpdir(),
    `mementos-list-redaction-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const env = isolatedStoreEnv(dbPath, { extra: blankLlmProviderEnv() });
  await assertLocalStoreBackend(CLI_PATH, env, dbPath);
  const init = await runCli(env, "--json", "list", "--limit", "1");
  expect(init.exitCode).toBe(0);
  return { dbPath, env };
}

async function makeSeeded(rows: SeedRow[]) {
  const store = await makeStore();
  seedRows(store.dbPath, rows);
  return store;
}

function cleanup(paths: string[]): void {
  for (const p of paths) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const f = p + suffix;
      if (existsSync(f)) try { unlinkSync(f); } catch { /* already gone */ }
    }
  }
}

const createdDbs: string[] = [];

describe("mementos list never leaks credential-shaped keys on stdout", () => {
  afterAll(() => cleanup(createdDbs));

  async function seeded(rows: SeedRow[]) {
    const store = await makeSeeded(rows);
    createdDbs.push(store.dbPath);
    return store;
  }

  test("JSON: token-shaped keys are redacted, coordination metadata kept", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-json-aws", key: AWS_ACCESS_KEY, value: "aws key used as a memory key" },
      { id: "m-json-npm", key: NPM_REGISTRY_TOKEN, value: "registry token used as a memory key" },
      { id: "m-json-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE, importance: 7 },
    ]);

    const { stdout, exitCode } = await runCli(env, "list", "--format", "json");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expect(Array.isArray(parsed)).toBe(true);

    // The credential-shaped keys must NEVER reach stdout.
    expect(stdout).not.toContain(AWS_ACCESS_KEY);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);

    // Coordination metadata survives: the rows are still listed by id, with
    // their scope/category/importance intact and the key redacted.
    const aws = parsed.find((m) => m.id === "m-json-aws");
    expect(aws).toBeTruthy();
    expect(aws!.scope).toBe("private");
    expect(aws!.category).toBe("fact");
    expect(aws!.importance).toBe(5);
    expect(String(aws!.key)).not.toContain(AWS_ACCESS_KEY);

    const npm = parsed.find((m) => m.id === "m-json-npm");
    expect(npm).toBeTruthy();
    expect(String(npm!.key)).not.toContain(NPM_REGISTRY_TOKEN);

    // Negative control: ordinary key/value untouched.
    const ok = parsed.find((m) => m.id === "m-json-ok");
    expect(ok!.key).toBe(ORDINARY_KEY);
    expect(ok!.value).toBe(ORDINARY_VALUE);
  });

  test("YAML: token-shaped keys are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-yaml-aws", key: AWS_ACCESS_KEY, value: "aws key as yaml fixture" },
      { id: "m-yaml-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE },
    ]);

    const { stdout, exitCode } = await runCli(env, "list", "--format", "yaml");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(AWS_ACCESS_KEY);
    expect(stdout).toContain(ORDINARY_KEY);
    expect(stdout).toContain(ORDINARY_VALUE);
  });

  test("CSV: token-shaped keys are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-csv-npm", key: NPM_REGISTRY_TOKEN, value: "registry token as csv fixture" },
      { id: "m-csv-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE },
    ]);

    const { stdout, exitCode } = await runCli(env, "list", "--format", "csv");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(stdout).toContain(ORDINARY_KEY);
    expect(stdout).toContain(ORDINARY_VALUE);
  });

  test("compact: token-shaped keys are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-compact-aws", key: AWS_ACCESS_KEY, value: "aws key as compact fixture" },
      { id: "m-compact-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE },
    ]);

    const { stdout, exitCode } = await runCli(env, "list", "--format", "compact", "--limit", "100");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(AWS_ACCESS_KEY);
    expect(stdout).toContain(ORDINARY_KEY);
    expect(stdout).toContain(ORDINARY_VALUE);
  });

  test("FULL-POPULATION compact projection leaks nothing", async () => {
    // Population of 151 rows — far beyond the compact default page of 20 — with
    // credential-shaped keys at the start, middle, and end of the population.
    const rows: SeedRow[] = [];
    for (let i = 0; i < 150; i++) {
      rows.push({ id: `m-pop-${i}`, key: `pop-${i}`, value: `population value ${i}` });
    }
    rows[0] = { id: "m-pop-first", key: AWS_ACCESS_KEY, value: "first row" };
    rows[75] = { id: "m-pop-mid", key: NPM_REGISTRY_TOKEN, value: "middle row" };
    rows.push({ id: "m-pop-last", key: `npm_${"z".repeat(36)}`, value: "last row" });

    const { dbPath, env } = await seeded(rows);
    // Project the FULL population in compact form (default page would cut at 20).
    const { stdout, exitCode } = await runCli(env, "list", "--format", "compact", "--limit", "1000");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(AWS_ACCESS_KEY);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(stdout).not.toContain(`npm_${"z".repeat(36)}`);
    // The full population was actually projected (not silently truncated at 20).
    expect(stdout).toContain("151 memories");
  });

  test("negative control: ordinary keys and values survive every format", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-neg-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE, importance: 9 },
    ]);

    for (const fmt of ["json", "yaml", "csv", "compact"]) {
      const { stdout, exitCode } = await runCli(env, "list", "--format", fmt, "--limit", "100");
      expect(exitCode).toBe(0);
      expect(stdout).toContain(ORDINARY_KEY);
      expect(stdout).toContain(ORDINARY_VALUE);
    }
  });
});
