/**
 * REAL Postgres regression coverage for BUG-0049: PATCHing a listless task
 * onto a project/list must backfill its short_id (COD-####).
 *
 * `createTask` only numbers a row when it already has a project to number it
 * under, so a task created without one got `short_id = null` — and the generic
 * PATCH (`tasks.update`, the /v1 PATCH path) never assigned one afterwards. The
 * row stayed invisible to the list's COD-#### numbering, breaking
 * sequence-continuity and the "next number" derivation that run notes, reviews
 * and owner queues rely on.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://localhost:5432/todos_reftest \
 *     bun test src/storage/postgres-short-id-backfill.pg.test.ts
 */
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createTodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";

const url = process.env.TODOS_TEST_PG_URL;
const pgTest = url ? test : test.skip;

async function fixture(run: (store: ReturnType<typeof createPostgresTodosStorageAdapter>) => Promise<void>) {
  const client = createTodosCloudQueryClient(url!, { max: 4 });
  const table = `todos_short_id_fixture_${randomUUID().replaceAll("-", "")}`;
  try {
    const store = createPostgresTodosStorageAdapter({
      client,
      service: "short-id-fixture",
      tableName: table,
      cursorTableName: `${table}_cursor`,
    });
    await run(store);
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${table}, ${table}_cursor`);
    await client.close();
  }
}

pgTest("PATCHing a listless task onto a project backfills its short_id", async () => {
  await fixture(async (store) => {
    const prefix = `F${randomUUID().replaceAll("-", "").slice(0, 4).toUpperCase()}`;
    const project = await store.projects.create({ name: "Short id fixture", path: `/tmp/${prefix}`, task_prefix: prefix });
    const taskList = await store.taskLists.create({
      name: "Short id fixture",
      slug: project.task_list_id!,
      project_id: project.id,
    });

    // Created WITHOUT a project: no project to number it under.
    const listless = await store.tasks.create({ title: "Filed before it had a home" });
    expect(listless.short_id).toBeNull();
    expect(listless.project_id).toBeNull();

    const patched = await store.tasks.update(listless.id, {
      version: listless.version,
      project_id: project.id,
      task_list_id: taskList.id,
    });

    // The placement PATCH must number the row from the target project's prefix
    // and counter — exactly what createTask would have done had the project
    // been known at creation time.
    expect(patched.short_id).toBe(`${prefix}-00001`);
    expect(patched.project_id).toBe(project.id);

    // ...and the number must come out of the SAME sequence, not a private one:
    // the next task created under the project continues from it.
    const sibling = await store.tasks.create({ title: "Next numbered sibling", project_id: project.id });
    expect(sibling.short_id).toBe(`${prefix}-00002`);
  });
}, 30000);

pgTest("a placement change never renumbers a task that already has a short_id", async () => {
  await fixture(async (store) => {
    const prefix = `G${randomUUID().replaceAll("-", "").slice(0, 4).toUpperCase()}`;
    const project = await store.projects.create({ name: "Renumber fixture", path: `/tmp/${prefix}`, task_prefix: prefix });
    const taskList = await store.taskLists.create({
      name: "Renumber fixture",
      slug: project.task_list_id!,
      project_id: project.id,
    });

    const numbered = await store.tasks.create({ title: "Already numbered", project_id: project.id });
    expect(numbered.short_id).toBe(`${prefix}-00001`);

    // A later placement-touching PATCH on a row that already carries a number
    // must leave that number alone — renumbering would detach every reference
    // already written against it.
    const patched = await store.tasks.update(numbered.id, {
      version: numbered.version,
      task_list_id: taskList.id,
      title: "Already numbered (retitled)",
    });
    expect(patched.short_id).toBe(`${prefix}-00001`);
    expect(patched.title).toBe("Already numbered (retitled)");
  });
}, 30000);
