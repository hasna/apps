import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { runRedactionCli } from "../../test-support/redaction-cli.js";
import {
  assertLocalStoreBackend,
  blankLlmProviderEnv,
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";

// ============================================================================
// Regression (todos e12c7659, CRITICAL): the read-verb fixes that landed for
// the credential-KEY leak class project `redactMemoryForOutput` across show /
// search / recall / tail / chain / pin / unpin / list, and `versions` redacts
// value/summary — but NONE of them redacts TAGS, and tags are storable raw via
// `save --tags` and via `update --tags`. An adversarial review reproduced the
// leak with a token-shaped TAG: it reaches stdout verbatim on every read verb
// that renders `memory.tags` (show/formatMemoryDetail, search/compact+JSON,
// recall/formatMemoryDetail, tail/formatWatchLine, chain, versions, pin/unpin
// receipts). The `when-to-use` verb was missed entirely and still renders the
// raw stored key AND the raw when_to_use text.
//
// The leak is POPULATION-dependent: a fixture-scale read can pass while a
// full-population read (tag row beyond the default page) still leaks, so a
// full-population tags case is included below.
//
// Fixture values are built by concatenation so no literal secret-shaped string
// sits in source; the runtime values still match the redactor's patterns.
// ============================================================================

const NPM_REGISTRY_TOKEN = "npm" + "_" + "a".repeat(36); // npm_ + 36 chars
const TOKEN_TAG = `tag-${NPM_REGISTRY_TOKEN}`; // a tag that is credential-shaped
const AWS_ACCESS_KEY = "AK" + "IAIOSFODNN7EXAMPLE"; // AKIA + 16 chars
const TOKEN_WHEN_TO_USE = `use when deploying ${NPM_REGISTRY_TOKEN}`;

const ORDINARY_KEY = "ordinary-key";
const ORDINARY_VALUE = "ordinary value that must survive";
const ORDINARY_TAGS = ["coordination", "knowledge"];

const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;

async function runCli(
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runRedactionCli(CLI_PATH, env, args);
}

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
  summary?: string | null;
  tags?: string[];
  when_to_use?: string | null;
  sequence_group?: string;
  sequence_order?: number;
}

/** Insert rows straight into the isolated SQLite file (bypasses write-side
 *  redaction, exactly the pre-existing/bypassed population that reproduces the
 *  read leak). */
function seedRows(dbPath: string, rows: SeedRow[]): void {
  const db = new Database(dbPath);
  try {
    const insert = db.prepare(`
      INSERT INTO memories (id, key, value, category, scope, summary, tags, importance, source, status, pinned, metadata, access_count, version, when_to_use, sequence_group, sequence_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agent', 'active', 0, '{}', 0, 1, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    db.run("BEGIN");
    for (const r of rows) {
      insert.run(
        r.id,
        r.key,
        r.value,
        r.category ?? "fact",
        r.scope ?? "private",
        r.summary ?? null,
        JSON.stringify(r.tags ?? []),
        r.importance ?? 5,
        r.when_to_use ?? null,
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
    `mementos-tags-redaction-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

describe("mementos read verbs never leak credential-shaped TAGS or when_to_use on stdout", () => {
  afterAll(() => cleanup(createdDbs));

  async function seeded(rows: SeedRow[]) {
    const store = await makeSeeded(rows);
    createdDbs.push(store.dbPath);
    return store;
  }

  // ==========================================================================
  // show
  // ==========================================================================

  test("show JSON: token-shaped tags are redacted, ordinary tags and coordination metadata kept", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-show-tag", key: "show-tag-key", value: "show tag fixture", tags: [TOKEN_TAG, ORDINARY_TAGS[0]!, ORDINARY_TAGS[1]!], importance: 7 },
      { id: "m-show-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE, tags: ORDINARY_TAGS },
    ]);

    const { stdout, exitCode } = await runCli(env, "--json", "show", "m-show-tag");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.id).toBe("m-show-tag");
    expect(parsed.importance).toBe(7);
    expect(parsed.scope).toBe("private");
    expect(Array.isArray(parsed.tags)).toBe(true);
    const tags = (parsed.tags as string[]).join(",");
    expect(tags).not.toContain(NPM_REGISTRY_TOKEN);
    // Ordinary tags survive.
    expect(tags).toContain(ORDINARY_TAGS[0]!);
    expect(tags).toContain(ORDINARY_TAGS[1]!);

    const ok = await runCli(env, "--json", "show", "m-show-ok");
    expect(ok.exitCode).toBe(0);
    const okParsed = JSON.parse(ok.stdout) as { tags: string[] };
    expect(okParsed.tags).toEqual(ORDINARY_TAGS);
  });

  test("show human: token-shaped tags are redacted, ordinary tags survive", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-showh-tag", key: "showh-tag-key", value: "show human tag fixture", tags: [TOKEN_TAG] },
      { id: "m-showh-ok", key: ORDINARY_KEY, value: ORDINARY_VALUE, tags: ORDINARY_TAGS },
    ]);

    const h = await runCli(env, "show", "m-showh-tag");
    expect(h.exitCode).toBe(0);
    expect(h.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(h.stdout).toContain("[REDACTED]");

    const ok = await runCli(env, "show", "m-showh-ok");
    expect(ok.stdout).toContain(ORDINARY_KEY);
    expect(ok.stdout).toContain(ORDINARY_VALUE);
    expect(ok.stdout).toContain(ORDINARY_TAGS[0]!);
    expect(ok.stdout).toContain(ORDINARY_TAGS[1]!);
  });

  // ==========================================================================
  // search
  // ==========================================================================

  test("search JSON + compact: token-shaped tags are redacted, ordinary tags survive", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-srch-tag", key: "srch-tag-key", value: "search tag fixture", tags: [TOKEN_TAG] },
      { id: "m-srch-ok", key: ORDINARY_KEY, value: `${ORDINARY_VALUE} fixture`, tags: ORDINARY_TAGS },
    ]);

    const j = await runCli(env, "search", "fixture", "--format", "json", "--limit", "100");
    expect(j.exitCode).toBe(0);
    expect(j.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(j.stdout) as Array<{ memory: Record<string, unknown>; score: number }>;
    expect(parsed.length).toBe(2);
    const tagRow = parsed.find((r) => r.memory.id === "m-srch-tag");
    expect(tagRow).toBeTruthy();
    expect(typeof tagRow!.score).toBe("number");
    const tags = (tagRow!.memory.tags as string[]).join(",");
    expect(tags).not.toContain(NPM_REGISTRY_TOKEN);
    const ok = parsed.find((r) => r.memory.id === "m-srch-ok");
    expect((ok!.memory.tags as string[]).join(",")).toContain(ORDINARY_TAGS[0]!);

    const c = await runCli(env, "search", "fixture", "--format", "compact", "--limit", "100");
    expect(c.exitCode).toBe(0);
    expect(c.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(c.stdout).toContain(ORDINARY_KEY);
  });

  test("search FULL-POPULATION tags: no tag leaks anywhere in the population", async () => {
    // Population of 121 rows; the token-shaped tag sits at the START, MIDDLE and
    // END of the population so a page-cut cannot hide it.
    const rows: SeedRow[] = [];
    for (let i = 0; i < 120; i++) {
      rows.push({ id: `m-tagpop-${i}`, key: `tagpop-${i}`, value: "shared population value", tags: ["population"] });
    }
    rows[0] = { id: "m-tagpop-first", key: "tagpop-first", value: "shared population value", tags: [TOKEN_TAG] };
    rows[60] = { id: "m-tagpop-mid", key: "tagpop-mid", value: "shared population value", tags: [`other-${NPM_REGISTRY_TOKEN}`] };
    rows.push({ id: "m-tagpop-last", key: "tagpop-last", value: "shared population value", tags: [`last-${NPM_REGISTRY_TOKEN}`] });

    const { dbPath, env } = await seeded(rows);
    const { stdout, exitCode } = await runCli(env, "search", "population", "--format", "json", "--limit", "1000");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(stdout) as Array<{ memory: Record<string, unknown> }>;
    expect(parsed.length).toBe(121);
    const allTags = parsed.flatMap((r) => r.memory.tags as string[]).join(",");
    expect(allTags).not.toContain(NPM_REGISTRY_TOKEN);
  });

  // ==========================================================================
  // recall
  // ==========================================================================

  test("recall JSON + human: token-shaped tags are redacted, coordination metadata kept", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-rec-tag", key: ORDINARY_KEY, value: "recall tag fixture", tags: [TOKEN_TAG], importance: 9 },
    ]);

    const j = await runCli(env, "--json", "recall", ORDINARY_KEY);
    expect(j.exitCode).toBe(0);
    expect(j.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(j.stdout) as { id: string; importance: number; tags: string[] };
    expect(parsed.id).toBe("m-rec-tag");
    expect(parsed.importance).toBe(9);
    expect(parsed.tags.join(",")).not.toContain(NPM_REGISTRY_TOKEN);

    const h = await runCli(env, "recall", ORDINARY_KEY);
    expect(h.exitCode).toBe(0);
    expect(h.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(h.stdout).toContain("m-rec-tag");
  });

  // ==========================================================================
  // tail
  // ==========================================================================

  test("tail --json: live row with a token-shaped tag streams redacted", async () => {
    const { dbPath, env } = await seeded([]);
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--json", "tail", "--interval", "150"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      await sleep(450);
      seedRows(dbPath, [
        { id: "m-tail-tag", key: "tail-tag-key", value: "tail tag fixture", tags: [TOKEN_TAG] },
      ]);
      await sleep(900);
    } finally {
      proc.kill();
    }
    const stdout = new TextDecoder().decode(await new Response(proc.stdout).arrayBuffer());
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(stdout).toContain("m-tail-tag");
  });

  // ==========================================================================
  // chain
  // ==========================================================================

  test("chain JSON + human: token-shaped tags are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-ch-tag", key: "chain-tag-key", value: "chain tag fixture", tags: [TOKEN_TAG], sequence_group: "seq-tags", sequence_order: 1 },
      { id: "m-ch-ok", key: "chain-ok-key", value: "chain ok fixture", tags: ORDINARY_TAGS, sequence_group: "seq-tags", sequence_order: 2 },
    ]);

    const j = await runCli(env, "--json", "chain", "seq-tags");
    expect(j.exitCode).toBe(0);
    expect(j.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(j.stdout) as Array<{ id: string; sequence_order: number; tags: string[] }>;
    expect(parsed.length).toBe(2);
    expect(parsed[0]!.sequence_order).toBe(1);
    expect(parsed[0]!.tags.join(",")).not.toContain(NPM_REGISTRY_TOKEN);
    expect(parsed[1]!.tags).toEqual(ORDINARY_TAGS);

    const h = await runCli(env, "chain", "seq-tags");
    expect(h.exitCode).toBe(0);
    expect(h.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(h.stdout).toContain("chain-ok-key");
  });

  // ==========================================================================
  // versions
  // ==========================================================================

  test("versions JSON + human: token-shaped version tags are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-ver-tag", key: "vers-tag-key", value: "versions tag fixture", tags: [TOKEN_TAG] },
    ]);
    const db = new Database(dbPath);
    try {
      db.run(
        `INSERT INTO memory_versions (id, memory_id, version, value, importance, scope, category, tags, summary, pinned, status, created_at)
         VALUES ('mv-tag-0', 'm-ver-tag', 0, 'old version value', 5, 'private', 'fact', '["${TOKEN_TAG}","coordination"]', NULL, 0, 'active', datetime('now'))`
      );
    } finally {
      db.close();
    }

    const j = await runCli(env, "--json", "versions", "m-ver-tag");
    expect(j.exitCode).toBe(0);
    expect(j.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(j.stdout) as { memory: Record<string, unknown>; versions: Array<{ tags: string[] }> };
    expect(parsed.versions.length).toBe(1);
    const vTags = parsed.versions[0]!.tags.join(",");
    expect(vTags).not.toContain(NPM_REGISTRY_TOKEN);
    expect(vTags).toContain("coordination");

    const h = await runCli(env, "versions", "m-ver-tag");
    expect(h.exitCode).toBe(0);
    expect(h.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(h.stdout).toContain("old version value");
  });

  // ==========================================================================
  // pin / unpin — mutation receipts echo the full stored row, which includes tags
  // ==========================================================================

  test("pin --json: token-shaped tag in the receipt is redacted, metadata kept", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-pin-tag", key: "pin-tag-key", value: "pin tag fixture", tags: [TOKEN_TAG] },
    ]);

    const j = await runCli(env, "--json", "pin", "m-pin-tag");
    expect(j.exitCode).toBe(0);
    expect(j.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(j.stdout) as { id: string; pinned: boolean; tags: string[] };
    expect(parsed.id).toBe("m-pin-tag");
    expect(parsed.pinned).toBe(true);
    expect(parsed.tags.join(",")).not.toContain(NPM_REGISTRY_TOKEN);
  });

  test("unpin --json: token-shaped tag in the receipt is redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-unpin-tag", key: "unpin-tag-key", value: "unpin tag fixture", tags: [TOKEN_TAG] },
    ]);

    const j = await runCli(env, "--json", "unpin", "m-unpin-tag");
    expect(j.exitCode).toBe(0);
    expect(j.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(j.stdout) as { id: string; pinned: boolean; tags: string[] };
    expect(parsed.id).toBe("m-unpin-tag");
    expect(parsed.pinned).toBe(false);
    expect(parsed.tags.join(",")).not.toContain(NPM_REGISTRY_TOKEN);
  });

  // ==========================================================================
  // when-to-use — the verb the read-verb fix missed entirely (NO_GO finding)
  // ==========================================================================

  test("when-to-use JSON: token-shaped key AND when_to_use are redacted", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-wtu-bad", key: NPM_REGISTRY_TOKEN, value: "when-to-use fixture", when_to_use: TOKEN_WHEN_TO_USE },
      { id: "m-wtu-ok", key: ORDINARY_KEY, value: "when-to-use ok fixture", when_to_use: "use when coordinating" },
    ]);

    const bad = await runCli(env, "--json", "when-to-use", "m-wtu-bad");
    expect(bad.exitCode).toBe(0);
    expect(bad.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(bad.stdout) as { id: string; key: string; when_to_use: string };
    expect(parsed.id).toBe("m-wtu-bad");
    expect(parsed.key).not.toContain(NPM_REGISTRY_TOKEN);
    expect(parsed.when_to_use).not.toContain(NPM_REGISTRY_TOKEN);

    const ok = await runCli(env, "--json", "when-to-use", "m-wtu-ok");
    expect(ok.exitCode).toBe(0);
    const okParsed = JSON.parse(ok.stdout) as { key: string; when_to_use: string };
    expect(okParsed.key).toBe(ORDINARY_KEY);
    expect(okParsed.when_to_use).toBe("use when coordinating");
  });

  test("when-to-use human: token-shaped key AND when_to_use are redacted, ordinary survives", async () => {
    const { dbPath, env } = await seeded([
      { id: "m-wtuh-bad", key: NPM_REGISTRY_TOKEN, value: "when-to-use human fixture", when_to_use: TOKEN_WHEN_TO_USE },
      { id: "m-wtuh-ok", key: ORDINARY_KEY, value: "when-to-use human ok fixture", when_to_use: "use when coordinating" },
    ]);

    const bad = await runCli(env, "when-to-use", "m-wtuh-bad");
    expect(bad.exitCode).toBe(0);
    expect(bad.stdout).not.toContain(NPM_REGISTRY_TOKEN);
    expect(bad.stdout).toContain("[REDACTED]");

    const ok = await runCli(env, "when-to-use", "m-wtuh-ok");
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain(ORDINARY_KEY);
    expect(ok.stdout).toContain("use when coordinating");
  });
});
