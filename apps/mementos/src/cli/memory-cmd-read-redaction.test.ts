import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import {
  assertLocalStoreBackend,
  blankLlmProviderEnv,
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";

// ============================================================================
// Regression (todos e12c7659): the `mementos list` read-path leak (I24-00018)
// was closed in 0.14.87 by running the full projected population through
// `redactMemoryForOutput` before any format branch. An adversarial review
// reproduced the SAME credential-key leak class on the OTHER read verbs:
//
//   - `show`            -> outputJson(memory) / formatMemoryDetail(memory)
//   - `search`          -> outputJson(results) / YAML / CSV / formatMemoryLine
//   - `recall`          -> outputJson(memory) / formatMemoryDetail(memory)
//   - `tail`            -> JSON.stringify({ memory }) / formatWatchLine(memory)
//   - `chain`           -> outputJson(memories) / human key:value lines
//
// Each verb renders the raw Memory object the DB returned, so a
// credential-shaped KEY stored by any write path reaches stdout verbatim.
// Search is additionally leaky through its HIGHLIGHT SNIPPETS: a query that
// matches inside a token-shaped key yields a snippet containing the whole
// key, so sanitizing the memory alone is not enough for that verb.
//
// The leak is POPULATION-dependent, not format-dependent: a fixture-scale read
// can pass while a full-population read (token row beyond the default page)
// still leaks. Full-population cases are included below.
//
// Fixture keys are built by concatenation (repo convention) so no literal
// secret-shaped string sits in source; the runtime values still match the
// incident detectors and the read-path redactor, which is what the test needs.
// ============================================================================

const AWS_ACCESS_KEY = "AK" + "IAIOSFODNN7EXAMPLE"; // AKIA + 16 chars (canonical AWS example access key)
const NPM_REGISTRY_TOKEN = "npm" + "_" + "a".repeat(36); // npm_ + 36 chars

const ORDINARY_KEY = "ordinary-key";
const ORDINARY_VALUE = "ordinary value that must survive";
const CHAIN_GROUP = "seq-redaction-fixture";

const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;

async function runCli(
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: await proc.exited };
}

/** Wait a fixed number of milliseconds (test-only helper for the live tail). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SeedRow {
  id: string;
  key: string;
  value: string;
  category?: string;
  scope?: string;
  importance?: number;
  sequence_group?: string;
  sequence_order?: number;
}

/** Insert rows straight into the isolated SQLite file (bypasses write-side
 *  redaction, exactly the population that reproduces the read leak). */
function seedRows(dbPath: string, rows: SeedRow[]): void {
  const db = new Database(dbPath);
  try {
    const insert = db.prepare(`
      INSERT INTO memories (id, key, value, category, scope, summary, tags, importance, source, status, pinned, metadata, access_count, version, sequence_group, sequence_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, '[]', ?, 'agent', 'active', 0, '{}', 0, 1, ?, ?, datetime('now'), datetime('now'))
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
        r.sequence_group ?? null,
        r.sequence_order ?? null,
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
    `mementos-read-redaction-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

describe("mementos read verbs never leak credential-shaped keys on stdout", () => {
  afterAll(() => cleanup(createdDbs));

  async function seeded(rows: SeedRow[]) {
    const store = await makeSeeded(rows);
    createdDbs.push(store.dbPath);
    return store;
  }

  // ==========================================================================
  // show
  // ==========================================================================

  test("show JSON: token-shaped keys are redacted, coordination metadata kept", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-show-aws", key: AWS_ACCESS_KEY, value: "aws key as show fixture" },
      { id: "m-show-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE, importance: 7 },
    ]);

    const { stdout, exitCode } = await runCli(env, "--json", "show", "m-show-aws");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(AWS_ACCESS_KEY);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.id).toBe("m-show-aws");
    expect(parsed.scope).toBe("private");
    expect(parsed.category).toBe("fact");
    expect(parsed.importance).toBe(5);
    expect(String(parsed.key)).not.toContain(AWS_ACCESS_KEY);

    const ok = await runCli(env, "--json", "show", "m-show-ok");
    expect(ok.exitCode).toBe(0);
    const okParsed = JSON.parse(ok.stdout) as Record<string, unknown>;
    expect(okParsed.key).toBe(ORDINARY_KEY);
    expect(okParsed.value).toBe(ORDINARY_VALUE);
  });

  test("show human: token-shaped keys are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-showh-npm", key: NPM_REGISTRY_TOKEN, value: "registry token as show fixture" },
      { id: "m-showh-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE },
    ]);

    const { stdout, exitCode } = await runCli(env, "show", "m-showh-npm");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(stdout).toContain("m-showh-npm");

    const ok = await runCli(env, "show", "m-showh-ok");
    expect(ok.stdout).toContain(ORDINARY_KEY);
    expect(ok.stdout).toContain(ORDINARY_VALUE);
  });

  // ==========================================================================
  // search
  // ==========================================================================

  test("search JSON: token-shaped keys are redacted, results still returned", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-srch-aws", key: AWS_ACCESS_KEY, value: "aws key used as a search fixture" },
      { id: "m-srch-npm", key: NPM_REGISTRY_TOKEN, value: "registry token used as a search fixture" },
      { id: "m-srch-ok", key: ORDINARY_KEY, value: `${ORDINARY_VALUE} fixture` },
    ]);

    const { stdout, exitCode } = await runCli(env, "search", "fixture", "--format", "json");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(AWS_ACCESS_KEY);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(stdout) as Array<{ memory: Record<string, unknown>; score: number }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(3);
    // Coordination metadata survives: the token rows are still returned, with
    // score intact and the key redacted.
    const npm = parsed.find((r) => r.memory.id === "m-srch-npm");
    expect(npm).toBeTruthy();
    expect(typeof npm!.score).toBe("number");
    expect(String(npm!.memory.key)).not.toContain(NPM_REGISTRY_TOKEN);
    // Negative control: ordinary key/value untouched.
    const ok = parsed.find((r) => r.memory.id === "m-srch-ok");
    expect(ok!.memory.key).toBe(ORDINARY_KEY);
    expect(ok!.memory.value).toBe(`${ORDINARY_VALUE} fixture`);
  });

  test("search YAML/CSV/compact: token-shaped keys are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-srchf-npm", key: NPM_REGISTRY_TOKEN, value: "registry token search fixture" },
      { id: "m-srchf-ok", key: ORDINARY_KEY, value: `${ORDINARY_VALUE} fixture` },
    ]);

    for (const fmt of ["yaml", "csv", "compact"]) {
      const { stdout, exitCode } = await runCli(env, "search", "fixture", "--format", fmt, "--limit", "100");
      expect(exitCode).toBe(0);
      expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
      expect(stdout).toContain(ORDINARY_KEY);
    }
  });

  test("search highlight snippets never carry the token-shaped key", async () => {
    const { dbPath, env } = await seeded([
      // Querying the full token key matches the key field exactly; the
      // extractHighlights snippet window for that match spans the entire
      // 40-char key, so the full token appears in the `highlights` array of
      // the JSON output on the unfixed build.
      { id: "m-hl-npm", key: NPM_REGISTRY_TOKEN, value: "registry token highlight fixture" },
    ]);

    const { stdout, exitCode } = await runCli(env, "search", NPM_REGISTRY_TOKEN, "--format", "json");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(stdout) as Array<{ memory: Record<string, unknown>; highlights?: Array<{ field: string; snippet: string }> }>;
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.memory.id).toBe("m-hl-npm");
    // The key field highlight snippet is redacted.
    const keyHighlight = parsed[0]!.highlights?.find((h) => h.field === "key");
    expect(keyHighlight).toBeTruthy();
    expect(String(keyHighlight!.snippet)).not.toContain(NPM_REGISTRY_TOKEN);
    // And the memory's own key is redacted.
    expect(String(parsed[0]!.memory.key)).not.toContain(NPM_REGISTRY_TOKEN);
  });

  test("search FULL-POPULATION projection leaks nothing", async () => {
    // Population of 121 rows, with credential-shaped keys at the start, middle,
    // and end, all matching the query. JSON returns the full population.
    const rows: SeedRow[] = [];
    for (let i = 0; i < 120; i++) {
      rows.push({ id: `m-pop-${i}`, key: `pop-${i}`, value: "shared population value" });
    }
    rows[0] = { id: "m-pop-first", key: AWS_ACCESS_KEY, value: "shared population value" };
    rows[60] = { id: "m-pop-mid", key: NPM_REGISTRY_TOKEN, value: "shared population value" };
    rows.push({ id: "m-pop-last", key: `npm_${"z".repeat(36)}`, value: "shared population value" });

    const { dbPath, env } = await seeded(rows);
    const { stdout, exitCode } = await runCli(env, "search", "population", "--format", "json", "--limit", "1000");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(AWS_ACCESS_KEY);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(stdout).not.toContain(`npm_${"z".repeat(36)}`);
    const parsed = JSON.parse(stdout) as Array<{ memory: Record<string, unknown> }>;
    expect(parsed.length).toBe(121);
  });

  // ==========================================================================
  // recall
  // ==========================================================================

  test("recall exact JSON + human: token-shaped keys are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-rec-npm", key: NPM_REGISTRY_TOKEN, value: "registry token recall fixture", importance: 9 },
    ]);

    const j = await runCli(env, "--json", "recall", NPM_REGISTRY_TOKEN);
    expect(j.exitCode).toBe(0);
    expect(j.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(j.stdout) as Record<string, unknown>;
    expect(parsed.id).toBe("m-rec-npm");
    expect(parsed.importance).toBe(9);
    expect(String(parsed.key)).not.toContain(NPM_REGISTRY_TOKEN);

    const h = await runCli(env, "recall", NPM_REGISTRY_TOKEN);
    expect(h.exitCode).toBe(0);
    expect(h.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(h.stdout).toContain("m-rec-npm");
  });

  test("recall --fuzzy: returned_key and memory are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-rec-fz", key: NPM_REGISTRY_TOKEN, value: "registry token fuzzy recall fixture" },
    ]);

    // Exact key "registry" is absent -> falls back to nearest match (exit 2).
    const { stdout, exitCode } = await runCli(env, "--json", "recall", "registry", "--fuzzy");
    expect(exitCode).toBe(2);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.fuzzy_match).toBe(true);
    expect(String(parsed.returned_key)).not.toContain(NPM_REGISTRY_TOKEN);
    const mem = parsed.memory as Record<string, unknown>;
    expect(String(mem.key)).not.toContain(NPM_REGISTRY_TOKEN);
    expect(mem.id).toBe("m-rec-fz");
  });

  // ==========================================================================
  // tail
  // ==========================================================================

  test("tail --json: live token-shaped-key row is streamed redacted", async () => {
    const { dbPath, env } = await seeded([]);
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--json", "tail", "--interval", "150"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      // Let the poller start and take its first (empty) tick.
      await sleep(450);
      seedRows(dbPath, [
        { id: "m-tail-npm", key: NPM_REGISTRY_TOKEN, value: "registry token tail fixture" },
        { id: "m-tail-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE },
      ]);
      // Give the poller enough ticks to observe the insert.
      await sleep(900);
    } finally {
      proc.kill();
    }
    const stdout = new TextDecoder().decode(await new Response(proc.stdout).arrayBuffer());
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(stdout).toContain(ORDINARY_KEY);
    expect(stdout).toContain("m-tail-npm");
  });

  test("tail human: live token-shaped-key row is streamed redacted", async () => {
    const { dbPath, env } = await seeded([]);
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "tail", "--interval", "150"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      await sleep(450);
      seedRows(dbPath, [
        { id: "m-tailh-npm", key: NPM_REGISTRY_TOKEN, value: "registry token tail human fixture" },
        { id: "m-tailh-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE },
      ]);
      await sleep(900);
    } finally {
      proc.kill();
    }
    const stdout = new TextDecoder().decode(await new Response(proc.stdout).arrayBuffer());
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(stdout).toContain(ORDINARY_KEY);
    // Human tail renders the redacted key and the value text (not the id).
    expect(stdout).toContain("[REDACTED]");
    expect(stdout).toContain("registry token tail human fixture");
  });

  // ==========================================================================
  // chain
  // ==========================================================================

  test("chain JSON + human: token-shaped keys are redacted, order metadata kept", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-ch-1", key: "step-one", value: "first step", sequence_group: CHAIN_GROUP, sequence_order: 1 },
      { id: "m-ch-2", key: NPM_REGISTRY_TOKEN, value: "registry token chain fixture", sequence_group: CHAIN_GROUP, sequence_order: 2 },
      { id: "m-ch-3", key: "step-three", value: "third step", sequence_group: CHAIN_GROUP, sequence_order: 3 },
    ]);

    const j = await runCli(env, "--json", "chain", CHAIN_GROUP);
    expect(j.exitCode).toBe(0);
    expect(j.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(j.stdout) as Array<Record<string, unknown>>;
    expect(parsed.length).toBe(3);
    const step2 = parsed.find((m) => m.id === "m-ch-2");
    expect(step2).toBeTruthy();
    expect(step2!.sequence_order).toBe(2);
    expect(String(step2!.key)).not.toContain(NPM_REGISTRY_TOKEN);
    expect(parsed[0]!.key).toBe("step-one");
    expect(parsed[2]!.key).toBe("step-three");

    const h = await runCli(env, "chain", CHAIN_GROUP);
    expect(h.exitCode).toBe(0);
    expect(h.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(h.stdout).toContain("step-one");
    expect(h.stdout).toContain("step-three");
  });

  // ==========================================================================
  // versions (same show surface)
  // ==========================================================================

  test("versions: token-shaped keys and version values are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-ver-npm", key: NPM_REGISTRY_TOKEN, value: "registry token versions fixture" },
    ]);
    const db = new Database(dbPath);
    try {
      db.run(
        `INSERT INTO memory_versions (id, memory_id, version, value, importance, scope, category, tags, summary, pinned, status, created_at)
         VALUES ('mv-1', 'm-ver-npm', 0, '${NPM_REGISTRY_TOKEN} = old version value', 5, 'private', 'fact', '[]', NULL, 0, 'active', datetime('now'))`
      );
    } finally {
      db.close();
    }

    const j = await runCli(env, "--json", "versions", "m-ver-npm");
    expect(j.exitCode).toBe(0);
    expect(j.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(j.stdout) as { memory: Record<string, unknown>; versions: Array<Record<string, unknown>> };
    expect(String(parsed.memory.key)).not.toContain(NPM_REGISTRY_TOKEN);
    expect(parsed.memory.id).toBe("m-ver-npm");
    expect(parsed.versions.length).toBe(1);
    expect(String(parsed.versions[0]!.value)).not.toContain(NPM_REGISTRY_TOKEN);

    const h = await runCli(env, "versions", "m-ver-npm");
    expect(h.exitCode).toBe(0);
    expect(h.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    // Human versions renders the redacted key and the version value (not the id).
    expect(h.stdout).toContain("[REDACTED]");
    expect(h.stdout).toContain("old version value");
  });
});
