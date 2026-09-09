import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createTodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";

const url = process.env.TODOS_TEST_PG_URL;
const pgTest = url ? test : test.skip;

async function fixture(run: (store: ReturnType<typeof createPostgresTodosStorageAdapter>) => Promise<void>) {
  const client = createTodosCloudQueryClient(url!, { max: 4 });
  const table = `todos_coordination_fixture_${randomUUID().replaceAll("-", "")}`;
  try {
    const store = createPostgresTodosStorageAdapter({ client, service: "coordination-fixture", tableName: table, cursorTableName: `${table}_cursor` });
    await run(store);
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${table}, ${table}_cursor`);
    await client.close();
  }
}

pgTest("concurrent reciprocal dependencies commit exactly one edge and keep the graph acyclic", async () => {
  await fixture(async store => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const a = await store.tasks.create({ title: "Synthetic graph A" });
      const b = await store.tasks.create({ title: "Synthetic graph B" });
      const results = await Promise.allSettled([
        store.dependencies!.add(a.id, b.id),
        store.dependencies!.add(b.id, a.id),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const [aEdges, bEdges] = await Promise.all([store.dependencies!.list(a.id), store.dependencies!.list(b.id)]);
      expect(aEdges.dependencies.length + bEdges.dependencies.length).toBe(1);
      expect(aEdges.dependencies.some(edge => edge.depends_on === b.id) && bEdges.dependencies.some(edge => edge.depends_on === a.id)).toBe(false);
    }
  });
}, 20000);

pgTest("concurrent independent dependency writes both persist", async () => {
  await fixture(async store => {
    const a = await store.tasks.create({ title: "Synthetic independent A" });
    const b = await store.tasks.create({ title: "Synthetic independent B" });
    const c = await store.tasks.create({ title: "Synthetic independent C" });
    const results = await Promise.allSettled([store.dependencies!.add(a.id, b.id), store.dependencies!.add(a.id, c.id)]);
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    const edges = await store.dependencies!.list(a.id);
    expect(edges.dependencies.map(edge => edge.depends_on).sort()).toEqual([b.id, c.id].sort());
    expect((await store.dependencies!.list(b.id)).dependencies).toEqual([]);
    expect((await store.dependencies!.list(c.id)).dependencies).toEqual([]);
  });
}, 20000);

pgTest("real PostgreSQL task lock and version CAS each allow only one concurrent winner", async () => {
  await fixture(async store => {
    const task = await store.tasks.create({ title: "Synthetic coordination CAS" });
    const locks = await Promise.allSettled([store.tasks.lock!(task.id, "first-agent"), store.tasks.lock!(task.id, "second-agent")]);
    const winners = locks.filter(result => result.status === "fulfilled" && result.value.success);
    expect(winners).toHaveLength(1);
    const held = (await store.tasks.get(task.id))!;
    expect(["first-agent", "second-agent"]).toContain(held.locked_by);
    await expect(store.tasks.unlock!(task.id, held.locked_by === "first-agent" ? "second-agent" : "first-agent")).rejects.toThrow();
    expect((await store.tasks.get(task.id))!.locked_by).toBe(held.locked_by);
    expect(await store.tasks.unlock!(task.id, held.locked_by!)).toBe(true);
    const current = (await store.tasks.get(task.id))!;
    const updates = await Promise.allSettled([
      store.tasks.update(task.id, { version: current.version, priority: "high" }),
      store.tasks.update(task.id, { version: current.version, priority: "low" }),
    ]);
    expect(updates.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const final = (await store.tasks.get(task.id))!;
    expect(final.version).toBe(current.version + 1);
    const winner = updates.find(result => result.status === "fulfilled");
    expect(final.priority).toBe(winner?.status === "fulfilled" ? winner.value.priority : undefined);
  });
}, 20000);
