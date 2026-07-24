/**
 * Cross-backend search PARITY: SQLite (bun:sqlite FTS5) vs Postgres
 * (todos_sync_records tsvector/trigram). The same corpus and the same queries
 * must return equivalent ranked results on both backends, so a cloud/self-hosted
 * deployment behaves like a local one.
 *
 * Fuzzy/typo matching is deliberately EXCLUDED from parity: it is a Postgres-only
 * pg_trgm capability (covered in postgres-search.pg.test.ts). Everything else —
 * full-text, multi-term AND, phrases, diacritics folding, tag matching, and
 * relevance ranking (title > description) — must agree.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://user@127.0.0.1:5432/todos_search_test \
 *     bun test src/lib/search-parity.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { searchTasks } from "./search.js";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "../storage/cloud-client.js";
import { createPostgresTodosStorageAdapter } from "../storage/postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "../storage/postgres-sync.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import type { Database } from "bun:sqlite";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-parity-${process.pid}-${Date.now()}`;

interface Seed {
  title: string;
  description: string;
  tags: string[];
}

const CORPUS: Seed[] = [
  { title: "Fix login authentication bug", description: "users cannot log in", tags: ["urgent", "auth"] },
  { title: "Add dashboard", description: "authentication metrics panel", tags: [] },
  { title: "Café menu redesign", description: "seasonal polish", tags: ["design"] },
  { title: "Login rate limiting", description: "throttle brute force on login", tags: ["auth"] },
  { title: "Unrelated chore", description: "cleanup the garage", tags: ["home"] },
];

describe.skipIf(!PG_URL)("SQLite vs Postgres search parity", () => {
  let db: Database;
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;

  beforeAll(async () => {
    // SQLite corpus.
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    db = getDatabase();
    for (const seed of CORPUS) createTask(seed, db);

    // Postgres corpus (identical titles/descriptions/tags).
    client = createTodosCloudQueryClient(PG_URL!);
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    store = createPostgresTodosStorageAdapter({ client, service: SERVICE });
    let n = 0;
    for (const seed of CORPUS) {
      const id = `parity${(++n).toString().padStart(3, "0")}-0000-4000-8000-000000000000`;
      const payload = {
        id,
        short_id: `PAR-${n}`,
        title: seed.title,
        description: seed.description,
        tags: seed.tags,
        status: "pending",
        priority: "medium",
        parent_id: null,
        project_id: null,
        version: 1,
        created_at: "2026-07-20T00:00:00.000Z",
        updated_at: "2026-07-20T00:00:00.000Z",
      };
      await client.query(
        `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at, deleted_at)
         VALUES ($1, 'tasks', $2, $3::jsonb, now(), NULL)
         ON CONFLICT (service, object_type, object_id) DO UPDATE SET payload = EXCLUDED.payload`,
        [SERVICE, id, payload],
      );
    }
    await client.query("ANALYZE todos_sync_records");
  });

  afterAll(async () => {
    closeDatabase();
    delete process.env["TODOS_DB_PATH"];
    if (!PG_URL) return;
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    await client.close();
  });

  const sqliteTitles = (query: string) =>
    searchTasks({ query }, undefined, undefined, db).map((t) => t.title);
  const pgTitles = async (query: string) =>
    (await store.tasks.list({ query })).map((t) => t.title);

  const parity = async (query: string, expected: string[], topTitle?: string) => {
    const sq = sqliteTitles(query);
    const pg = await pgTitles(query);
    // Membership parity.
    expect([...sq].sort()).toEqual([...expected].sort());
    expect([...pg].sort()).toEqual([...expected].sort());
    // Ranking parity: both backends put the same task first.
    if (topTitle) {
      expect(sq[0]).toBe(topTitle);
      expect(pg[0]).toBe(topTitle);
    }
  };

  test("full-text term matches the same tasks, ranked title-first", async () => {
    await parity("authentication", ["Fix login authentication bug", "Add dashboard"], "Fix login authentication bug");
  });

  test("multi-term query is AND on both backends", async () => {
    await parity("login authentication", ["Fix login authentication bug"]);
  });

  test("quoted phrase matches identically", async () => {
    await parity('"rate limiting"', ["Login rate limiting"]);
  });

  test("diacritics folded identically ('cafe' matches 'Café')", async () => {
    await parity("cafe", ["Café menu redesign"], "Café menu redesign");
  });

  test("tag matches identically", async () => {
    await parity("urgent", ["Fix login authentication bug"], "Fix login authentication bug");
  });

  test("no-match query is empty on both backends", async () => {
    await parity("nonexistentxyzterm", []);
  });
});
