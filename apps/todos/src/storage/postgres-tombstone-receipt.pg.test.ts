import { test, expect } from "bun:test";
import { createTodosCloudQueryClient } from "./cloud-client.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";

const pg = process.env.TODOS_TEST_PG_URL ? test : test.skip;
pg("tombstone import receipts follow PostgreSQL submillisecond clock decisions", async () => {
  const client = createTodosCloudQueryClient(process.env.TODOS_TEST_PG_URL!, { max: 1 });
  const table = `tombstone_receipt_${crypto.randomUUID().replaceAll("-", "")}`;
  const service = crypto.randomUUID();
  const store = createPostgresTodosStorageAdapter({ client, service, tableName: table, cursorTableName: `${table}_c` });
  try {
    const template = await store.templates.create({ name: "Synthetic clock fixture" });
    const snapshot = { ...await store.sync.exportSnapshot!(), templates: [], templateTasks: [], tombstones: [] };
    await client.query(`UPDATE ${table} SET updated_at=$1::timestamptz,version=5 WHERE service=$2 AND object_type='templates' AND object_id=$3`,
      ["2027-01-01T00:00:00.000500Z", service, template.id]);
    const read = async () => (await client.query(`SELECT object_id,payload,deleted_at,updated_at::text,version FROM ${table} WHERE service=$1 ORDER BY object_id`, [service])).rows;
    const before = await read();
    const input = { ...snapshot, tombstones: [{ object_type: "templates" as const, object_id: template.id,
      deleted_at: "2027-01-01T00:00:00.000400Z", version: 1 }] };
    const stale = await store.sync.importSnapshot!(input);
    expect(await read()).toEqual(before);
    expect(stale.errors).toEqual([]);
    expect(stale.deleted ?? 0).toBe(0);
    expect(stale.skipped).toBe(1);
    // Equal timestamps remain accepted by the existing timestamp-only tombstone
    // predicate, even with a lower version. This fix changes receipts, not policy.
    input.tombstones[0]!.deleted_at = "2027-01-01T00:00:00.000500Z";
    const equal = await store.sync.importSnapshot!(input);
    expect(equal.errors).toEqual([]);
    expect(equal.deleted).toBe(1);
    expect(equal.skipped).toBe(0);
    expect(await store.templates.get(template.id)).toBeNull();
    input.tombstones[0]!.object_id = "absent-synthetic-template";
    const inserted = await store.sync.importSnapshot!(input);
    expect(inserted.errors).toEqual([]);
    expect(inserted.deleted).toBe(1);
    expect(await read()).toHaveLength(2);
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${table}, ${table}_c`);
    await client.close();
  }
}, 20000);
