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
// Regression (todos e12c7659, CRITICAL): the WRITE path never redacts KEYS or
// TAGS. `createMemory`/`updateMemory`/`bulkUpsertMemories` pass `value` and
// `summary` through `redactSecrets` but store `key`, `tags` and `when_to_use`
// raw — so a `save --key <token>` or `save --tags <token>` lands the raw
// credential in the store, and every later read (and the mutation RECEIPTS of
// `save`/`update` themselves) can emit it verbatim.
//
// Acceptance criterion 2: "Write path redacts credential-shaped keys and tags
// BEFORE storage (so new rows do not hold them raw)." Criterion 1: "NO mementos
// read verb or mutation receipt emits a credential-shaped key, tag, when_to_use,
// value, or summary verbatim."
//
// These tests drive the real CLI `save`/`update` (which route through
// createMemory/updateMemory) and then read the stored rows straight out of the
// isolated SQLite file to prove what was actually persisted — a receipt that
// looks redacted is not the same as a store that holds no raw credential.
// ============================================================================

const NPM_REGISTRY_TOKEN = "npm" + "_" + "a".repeat(36); // npm_ + 36 chars
const AWS_ACCESS_KEY = "AK" + "IAIOSFODNN7EXAMPLE"; // AKIA + 16 chars
const TOKEN_TAG = `tag-${NPM_REGISTRY_TOKEN}`;

const ORDINARY_KEY = "ordinary-key";
const ORDINARY_VALUE = "ordinary value that must survive";
const ORDINARY_TAGS = ["coordination", "knowledge"];

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

/** Read one stored row's key/tags/when_to_use directly out of the isolated DB. */
function readStored(dbPath: string, id: string): {
  key: string;
  tags: string[];
  when_to_use: string | null;
  summary: string | null;
} {
  const db = new Database(dbPath);
  try {
    const row = db
      .query(
        `SELECT key, tags, when_to_use, summary FROM memories WHERE id = ?`
      )
      .get(id) as { key: string; tags: string; when_to_use: string | null; summary: string | null } | null;
    if (!row) throw new Error(`no stored row for ${id}`);
    return {
      key: row.key,
      tags: JSON.parse(row.tags) as string[],
      when_to_use: row.when_to_use,
      summary: row.summary,
    };
  } finally {
    db.close();
  }
}

interface SeedRow {
  id: string;
  key: string;
  value: string;
  category?: string;
  scope?: string;
  importance?: number;
  tags?: string[];
  when_to_use?: string | null;
}

/** Insert rows straight into the isolated SQLite file (bypasses write-side
 *  redaction — the pre-existing/bypassed population the read path must project). */
function seedRows(dbPath: string, rows: SeedRow[]): void {
  const db = new Database(dbPath);
  try {
    const insert = db.prepare(`
      INSERT INTO memories (id, key, value, category, scope, summary, tags, importance, source, status, pinned, metadata, access_count, version, when_to_use, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'agent', 'active', 0, '{}', 0, 1, ?, datetime('now'), datetime('now'))
    `);
    db.run("BEGIN");
    for (const r of rows) {
      insert.run(
        r.id,
        r.key,
        r.value,
        r.category ?? "fact",
        r.scope ?? "private",
        JSON.stringify(r.tags ?? []),
        r.importance ?? 5,
        r.when_to_use ?? null,
      );
    }
    db.run("COMMIT");
  } finally {
    db.close();
  }
}

async function makeStore(): Promise<{ dbPath: string; env: Record<string, string> }> {
  const dbPath = join(
    tmpdir(),
    `mementos-write-redaction-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const env = isolatedStoreEnv(dbPath, { extra: blankLlmProviderEnv() });
  await assertLocalStoreBackend(CLI_PATH, env, dbPath);
  const init = await runCli(env, "--json", "list", "--limit", "1");
  expect(init.exitCode).toBe(0);
  return { dbPath, env };
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

describe("mementos write path stores no credential-shaped key/tag raw, and mutation receipts emit none", () => {
  afterAll(() => cleanup(createdDbs));

  async function store() {
    const s = await makeStore();
    createdDbs.push(s.dbPath);
    return s;
  }

  // ==========================================================================
  // write-path storage: `save` and `update` must NOT persist a raw key/tag
  // ==========================================================================

  test("save stores a credential-shaped KEY redacted (acceptance 2)", async () => {
    const { dbPath, env } = await store();
    const { stdout, exitCode } = await runCli(env, "save", NPM_REGISTRY_TOKEN, "save key fixture");
    expect(exitCode).toBe(0);
    // The receipt must not echo the raw key either (acceptance 1).
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    // And the STORED row must hold the redacted form, never the raw key.
    const rows = (() => {
      const db = new Database(dbPath);
      try {
        return db.query(`SELECT id, key FROM memories WHERE key IS NOT NULL`).all() as Array<{ id: string; key: string }>;
      } finally {
        db.close();
      }
    })();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.key).not.toContain(NPM_REGISTRY_TOKEN);
      expect(r.key).not.toContain("npm_");
    }
  });

  test("save --tags stores a credential-shaped TAG redacted (acceptance 2)", async () => {
    const { dbPath, env } = await store();
    const { stdout, exitCode } = await runCli(
      env,
      "save",
      "write-tag-key",
      "save tag fixture",
      "--tags",
      `${TOKEN_TAG},${ORDINARY_TAGS[0]!}`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const rows = (() => {
      const db = new Database(dbPath);
      try {
        return db.query(`SELECT id, key FROM memories WHERE key = 'write-tag-key'`).all() as Array<{ id: string; key: string }>;
      } finally {
        db.close();
      }
    })();
    expect(rows.length).toBe(1);
    const stored = readStored(dbPath, rows[0]!.id);
    expect(stored.tags.join(",")).not.toContain(NPM_REGISTRY_TOKEN);
    expect(stored.tags.join(",")).toContain(ORDINARY_TAGS[0]!);
  });

  test("update --tags stores a credential-shaped TAG redacted (acceptance 2)", async () => {
    const { dbPath, env } = await store();
    seedRows(dbPath, [
      { id: "m-upd-tag", key: "update-tag-key", value: "update tag fixture", tags: ["seed"] },
    ]);
    const { stdout, exitCode } = await runCli(
      env,
      "update",
      "m-upd-tag",
      "--tags",
      `${TOKEN_TAG},coordination`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const stored = readStored(dbPath, "m-upd-tag");
    expect(stored.tags.join(",")).not.toContain(NPM_REGISTRY_TOKEN);
    expect(stored.tags.join(",")).toContain("coordination");
  });

  // ==========================================================================
  // mutation receipts: `save` and `update` JSON/human receipts emit no raw
  // ==========================================================================

  test("save --json receipt: token-shaped key and tag redacted, id/outcome kept", async () => {
    const { dbPath, env } = await store();
    const { stdout, exitCode } = await runCli(
      env,
      "--json",
      "save",
      AWS_ACCESS_KEY,
      "receipt fixture",
      "--tags",
      TOKEN_TAG,
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(AWS_ACCESS_KEY);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(typeof parsed.id).toBe("string");
    expect(["created", "updated"]).toContain(parsed.outcome);
    expect(String(parsed.key)).not.toContain(AWS_ACCESS_KEY);
    const tags = (parsed.tags as string[]).join(",");
    expect(tags).not.toContain(NPM_REGISTRY_TOKEN);
    // Coordination metadata preserved.
    expect(parsed.scope).toBe("private");
    expect(parsed.category).toBe("knowledge");
  });

  test("save human receipt: token-shaped key redacted", async () => {
    const { dbPath, env } = await store();
    const { stdout, exitCode } = await runCli(env, "save", AWS_ACCESS_KEY, "receipt human fixture");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(AWS_ACCESS_KEY);
    expect(stdout).toContain("[REDACTED]");
  });

  test("update --json receipt: token-shaped stored key and new tag redacted, updated_fields kept", async () => {
    const { dbPath, env } = await store();
    seedRows(dbPath, [
      { id: "m-upd-rec", key: NPM_REGISTRY_TOKEN, value: "update receipt fixture", tags: [] },
    ]);
    const { stdout, exitCode } = await runCli(
      env,
      "--json",
      "update",
      "m-upd-rec",
      "--tags",
      TOKEN_TAG,
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(NPM_REGISTRY_TOKEN);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.id).toBe("m-upd-rec");
    expect(parsed.updated_fields).toContain("tags");
    expect(String(parsed.key)).not.toContain(NPM_REGISTRY_TOKEN);
    const tags = (parsed.tags as string[]).join(",");
    expect(tags).not.toContain(NPM_REGISTRY_TOKEN);
  });

  test("update human receipt: token-shaped stored key redacted", async () => {
    const { dbPath, env } = await store();
    seedRows(dbPath, [
      { id: "m-upd-rech", key: AWS_ACCESS_KEY, value: "update receipt human fixture", tags: [] },
    ]);
    const { stdout, exitCode } = await runCli(env, "update", "m-upd-rech", "--importance", "7");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(AWS_ACCESS_KEY);
    expect(stdout).toContain("[REDACTED]");
  });

  // ==========================================================================
  // forget disambiguation surfaces stored keys (read of the pre-existing
  // population) — the same projection duty as every other read.
  // ==========================================================================

  test("forget ambiguous --json: stored token-shaped keys redacted, ids kept", async () => {
    const { dbPath, env } = await store();
    // Two rows sharing the token-shaped key in DIFFERENT scopes (the unique key
    // index is key+scope+agent+project+session, so scope distinguishes them).
    seedRows(dbPath, [
      { id: "m-fgt-1", key: NPM_REGISTRY_TOKEN, value: "forget fixture", tags: [], scope: "private" },
      { id: "m-fgt-2", key: NPM_REGISTRY_TOKEN, value: "forget fixture second", tags: [], scope: "global" },
      { id: "m-fgt-ok", key: ORDINARY_KEY, value: "forget ordinary fixture", tags: [] },
    ]);
    // Ambiguous: two rows share the raw token-shaped key -> disambiguation table.
    // The STORED keys echoed in `matches` must be projected (the `error` field
    // echoes the caller's own argument verbatim, per the established convention
    // for input echoes — same as recall's requested_key).
    const { stdout, exitCode } = await runCli(env, "--json", "forget", NPM_REGISTRY_TOKEN);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as { error: string; matches: Array<{ id: string; key: string }> };
    expect(parsed.matches.length).toBe(2);
    expect(parsed.matches.map((m) => m.id)).toEqual(["m-fgt-1", "m-fgt-2"]);
    for (const m of parsed.matches) {
      expect(m.key).not.toContain(NPM_REGISTRY_TOKEN);
      expect(m.key).not.toContain("npm_");
    }
    expect(JSON.stringify(parsed.matches)).not.toContain(NPM_REGISTRY_TOKEN);
  });

  // ==========================================================================
  // negative controls: ordinary keys/tags are stored and echoed verbatim
  // ==========================================================================

  test("negative control: save stores and echoes ordinary key/tags verbatim", async () => {
    const { dbPath, env } = await store();
    const { stdout, exitCode } = await runCli(
      env,
      "--json",
      "save",
      ORDINARY_KEY,
      ORDINARY_VALUE,
      "--tags",
      ORDINARY_TAGS.join(","),
      "--importance",
      "8",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain(ORDINARY_KEY);
    expect(stdout).toContain(ORDINARY_VALUE);
    expect(stdout).toContain(ORDINARY_TAGS[0]!);
    expect(stdout).toContain(ORDINARY_TAGS[1]!);
    const parsed = JSON.parse(stdout) as { id: string; key: string; importance: number; tags: string[] };
    expect(parsed.key).toBe(ORDINARY_KEY);
    expect(parsed.importance).toBe(8);
    expect(parsed.tags).toEqual(ORDINARY_TAGS);
    const stored = readStored(dbPath, parsed.id);
    expect(stored.key).toBe(ORDINARY_KEY);
    expect(stored.tags).toEqual(ORDINARY_TAGS);
  });

  test("negative control: update --tags with ordinary tags preserves them in the store", async () => {
    const { dbPath, env } = await store();
    seedRows(dbPath, [
      { id: "m-neg-upd", key: "neg-update-key", value: "neg update fixture", tags: ["seed"] },
    ]);
    const { stdout, exitCode } = await runCli(
      env,
      "--json",
      "update",
      "m-neg-upd",
      "--tags",
      ORDINARY_TAGS.join(","),
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { tags: string[] };
    expect(parsed.tags).toEqual(ORDINARY_TAGS);
    const stored = readStored(dbPath, "m-neg-upd");
    expect(stored.tags).toEqual(ORDINARY_TAGS);
  });
});
