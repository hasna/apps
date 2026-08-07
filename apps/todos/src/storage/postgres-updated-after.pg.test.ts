/**
 * REAL Postgres regression coverage for the `updated_after` since-cursor.
 *
 * ROOT CAUSE guarded here: `todos_try_timestamptz` was declared IMMUTABLE while
 * its body was a bare `$1::timestamptz`, which for a stamp carrying no offset
 * resolves against the session `TimeZone`. Postgres refuses to index that cast
 * directly — `ERROR: functions in index expression must be marked IMMUTABLE` —
 * and wrapping it in a falsely-IMMUTABLE function bypassed the guard instead of
 * satisfying it. Measured on PostgreSQL 16.13, index built under one zone and
 * read under another, same query, plan the only difference:
 *
 *       plan    | ids
 *     ----------+-------
 *      seqscan  | c
 *      indexscan| b,c
 *
 * Row `b` is `2026-06-10 11:24:47` — the legacy no-offset stamp the cursor
 * exists to serve. A poller silently misses changed rows and never learns it.
 *
 * The same defect made the two backends disagree: SQLite's `julianday()` reads a
 * no-offset stamp as UTC, Postgres read it as server-local, so an identical
 * fixture and cursor answered 2 rows on one and 3 on the other.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://user@127.0.0.1:5432/todos_cursor_test \
 *     bun test src/storage/postgres-updated-after.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-cursortest-${process.pid}-${Date.now()}`;

/** The genuinely mixed stored formats, measured on the deployed dataset 2026-08-07. */
const ROW_OLD = "2026-05-01T00:00:00.000Z";
const ROW_LEGACY = "2026-06-10 11:24:47"; // no offset — the population that broke
const ROW_MID = "2026-07-01 08:00:00"; // no offset, same-date discriminator
const ROW_NEW = "2026-08-05T18:54:55.814Z";
const ROW_UNPARSEABLE = "not-a-timestamp";

const ID_OLD = "bbbb0001-0000-4000-8000-000000000001";
const ID_LEGACY = "bbbb0002-0000-4000-8000-000000000002";
const ID_MID = "bbbb0003-0000-4000-8000-000000000003";
const ID_NEW = "bbbb0004-0000-4000-8000-000000000004";
const ID_BAD = "bbbb0005-0000-4000-8000-000000000005";

describe.skipIf(!PG_URL)("postgres updated_after since-cursor", () => {
  let client: TodosCloudQueryClient;
  // `SET TimeZone` and `SET enable_seqscan` are SESSION state, so on a pooled
  // client the SET and the query it is meant to govern can land on different
  // connections — and the test then measures nothing while passing. This one is
  // pinned to a single connection so the session GUCs actually apply.
  let pinned: TodosCloudQueryClient;
  let store: TodosStorageAdapter;

  const insert = async (id: string, updatedAt: string) => {
    const payload = {
      id,
      short_id: id.toUpperCase().slice(0, 8),
      title: `task ${id.slice(0, 8)}`,
      description: null,
      tags: [],
      status: "pending",
      priority: "medium",
      parent_id: null,
      project_id: null,
      version: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: updatedAt,
    };
    await client.query(
      `INSERT INTO todos_sync_records (service, object_type, object_id, payload, updated_at, deleted_at)
       VALUES ($1, 'tasks', $2, $3::jsonb, now(), NULL)
       ON CONFLICT (service, object_type, object_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [SERVICE, id, payload],
    );
  };

  const ids = (tasks: { id: string }[]) => tasks.map((t) => t.id).sort();

  beforeAll(async () => {
    client = createTodosCloudQueryClient(PG_URL!);
    pinned = createTodosCloudQueryClient(PG_URL!, { max: 1 });
    // THE BAD INDEX IS BUILT FIRST, ON PURPOSE. A migration that only ever runs
    // against a fresh database proves nothing about the clusters that already
    // ran the previous schema — and those are exactly the ones carrying corrupt
    // index entries. This reproduces that starting state before the fix runs.
    await client.query(`CREATE TABLE IF NOT EXISTS todos_sync_records (
      service text NOT NULL, object_type text NOT NULL, object_id text NOT NULL,
      payload jsonb NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz,
      source_machine_id text, version integer,
      PRIMARY KEY (service, object_type, object_id))`);
    await client.query(`CREATE OR REPLACE FUNCTION todos_try_timestamptz(text)
      RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
      AS $$ BEGIN RETURN $1::timestamptz; EXCEPTION WHEN others THEN RETURN NULL; END $$`);
    await client.query(`CREATE INDEX IF NOT EXISTS todos_sync_records_task_updated_at_idx
      ON todos_sync_records (todos_try_timestamptz(payload->>'updated_at'))
      WHERE object_type = 'tasks' AND deleted_at IS NULL`);

    // Now the shipped schema, which must REPLACE that index rather than leave it.
    for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    store = createPostgresTodosStorageAdapter({ client, service: SERVICE });

    await insert(ID_OLD, ROW_OLD);
    await insert(ID_LEGACY, ROW_LEGACY);
    await insert(ID_MID, ROW_MID);
    await insert(ID_NEW, ROW_NEW);
    await insert(ID_BAD, ROW_UNPARSEABLE);
    await client.query("ANALYZE todos_sync_records");
  });

  afterAll(async () => {
    if (!PG_URL) return;
    await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
    await client.close();
    await pinned.close();
  });

  test("the superseded index is REPLACED, not left in place beside the new one", async () => {
    // `CREATE OR REPLACE FUNCTION` does not rebuild dependent expression
    // indexes, and `CREATE INDEX IF NOT EXISTS` will not recreate an existing
    // one — so without an explicit drop, a deployed cluster keeps entries
    // computed by the old body and the fix silently does nothing there.
    const { rows } = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'todos_sync_records' AND indexname LIKE '%task_updated_at%'
        ORDER BY indexname`,
    );
    const names = rows.map((r) => r.indexname);
    // A positive control: if this query could not see indexes at all, the
    // "old one is gone" assertion below would pass vacuously.
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("todos_sync_records_task_updated_at_utc_idx");
    expect(names).not.toContain("todos_sync_records_task_updated_at_idx");
  });

  test("todos_try_timestamptz reads a no-offset stamp as UTC under ANY session zone", async () => {
    for (const zone of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      await pinned.query(`SET TimeZone TO '${zone}'`);
      // CONTROL: prove the SET actually took on THIS connection. Without it a
      // pooled or ignored SET would make every assertion below pass for the
      // wrong reason — the zone never changed, so of course the answer did not.
      // `SHOW TimeZone` names its column `TimeZone`, not `tz` — read it through
      // `current_setting` so the alias is ours and cannot silently be undefined.
      const { rows: [check] } = await pinned.query<{ tz: string }>(`SELECT current_setting('TimeZone') AS tz`);
      expect(check!.tz).toBe(zone);
      const { rows: [row] } = await pinned.query<{ epoch: string }>(
        `SELECT EXTRACT(EPOCH FROM todos_try_timestamptz($1))::text AS epoch`,
        [ROW_LEGACY],
      );
      // 2026-06-10T11:24:47Z. If the cast resolved against the session zone this
      // number would move by the offset — 9h under Tokyo, -7h under Los Angeles.
      // Compared numerically: Postgres renders EXTRACT(EPOCH) as numeric, so the
      // text is "1781090687.000000" and a string compare would fail on a correct
      // instant.
      expect(Number(row!.epoch)).toBe(Date.parse("2026-06-10T11:24:47.000Z") / 1000);
    }
    await pinned.query("SET TimeZone TO 'UTC'");
  });

  test("index scan and seq scan return the SAME rows, under every session zone", async () => {
    // The defect was invisible to any test that did not vary the plan: a seq
    // scan recomputes the expression and is correct, so only the index disagrees.
    const cursor = "2026-06-10T09:00:00.000Z";
    const sql = `SELECT string_agg(object_id, ',' ORDER BY object_id) AS ids
                   FROM todos_sync_records
                  WHERE service = $1 AND object_type = 'tasks' AND deleted_at IS NULL
                    AND todos_try_timestamptz(payload->>'updated_at') > $2::timestamptz`;
    for (const zone of ["UTC", "Asia/Tokyo"]) {
      await pinned.query(`SET TimeZone TO '${zone}'`);
      await pinned.query("SET enable_seqscan = on");
      await pinned.query("SET enable_indexscan = off");
      await pinned.query("SET enable_bitmapscan = off");
      const { rows: [seq] } = await pinned.query<{ ids: string }>(sql, [SERVICE, cursor]);
      await pinned.query("SET enable_seqscan = off");
      await pinned.query("SET enable_indexscan = on");
      await pinned.query("SET enable_bitmapscan = on");
      // CONTROL: prove the second read genuinely used the index. If the planner
      // fell back to a seq scan anyway, the two answers agree trivially and this
      // test would report health while never exercising the index at all.
      const { rows: plan } = await pinned.query<{ "QUERY PLAN": string }>(
        `EXPLAIN ${sql}`.replace("$1", `'${SERVICE}'`).replace("$2", `'${cursor}'`),
      );
      expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toContain("task_updated_at_utc_idx");
      const { rows: [idx] } = await pinned.query<{ ids: string }>(sql, [SERVICE, cursor]);
      expect(idx!.ids).toBe(seq!.ids);
      // ...and both must be the RIGHT answer, not merely equal to each other.
      // Two plans agreeing on the same wrong set is not a passing gate.
      expect(seq!.ids).toBe([ID_LEGACY, ID_MID, ID_NEW].sort().join(","));
    }
    await pinned.query("RESET enable_seqscan");
    await pinned.query("RESET enable_indexscan");
    await pinned.query("RESET enable_bitmapscan");
    await pinned.query("SET TimeZone TO 'UTC'");
  });

  test("a mid-range cursor returns strictly fewer rows, and not zero", async () => {
    const all = await store.tasks.list({});
    const cursored = await store.tasks.list({ updated_after: "2026-06-10T09:00:00.000Z" });
    expect(all.length).toBe(5);
    // The unparseable row is KEPT — "we cannot read this stamp" is not the same
    // claim as "this row is older than the cursor".
    expect(ids(cursored)).toEqual([ID_BAD, ID_LEGACY, ID_MID, ID_NEW].sort());
    expect(cursored.length).toBeLessThan(all.length);
    expect(cursored.length).toBeGreaterThan(0);
    expect(await store.tasks.count({ updated_after: "2026-06-10T09:00:00.000Z" })).toBe(4);
  });

  test("a cursor after every row returns only the unreadable one", async () => {
    const cursored = await store.tasks.list({ updated_after: "2027-01-01T00:00:00.000Z" });
    expect(ids(cursored)).toEqual([ID_BAD]);
    expect(await store.tasks.count({ updated_after: "2027-01-01T00:00:00.000Z" })).toBe(1);
  });

  test("the same-date case that separates an INSTANT comparison from a TEXT one", async () => {
    // As text " " (0x20) sorts before "T" (0x54), so "2026-07-01 08:00:00" reads
    // as EARLIER than "2026-07-01T00:00:00.000Z" and a string comparison drops
    // it. As an instant it is 8 hours later and must be returned.
    const cursored = await store.tasks.list({ updated_after: "2026-07-01T00:00:00.000Z" });
    expect(ids(cursored)).toContain(ID_MID);
    expect(ids(cursored)).toEqual([ID_BAD, ID_MID, ID_NEW].sort());
  });
});
