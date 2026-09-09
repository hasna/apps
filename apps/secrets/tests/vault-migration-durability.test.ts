import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { importVault } from "../src/server/vault-migration.js";
import { TABLES, type Snapshot } from "../src/migration/snapshot.js";
import type { PoolQueryClient } from "../src/generated/storage-kit/index.js";

test("unsafe migration durability settings refuse before authority, journal or payload access", async () => {
  for (const settings of [
    { fsync: "off", full_page_writes: "on", synchronous_commit: "on" },
    { fsync: "on", full_page_writes: "off", synchronous_commit: "on" },
    { fsync: "on", full_page_writes: "on", synchronous_commit: "off" },
    null,
  ]) {
    const statements: string[] = [];
    const tx = {
      async execute(sql: string) { statements.push(sql); },
      async get(sql: string) { statements.push(sql); return settings; },
    };
    const client = { async transaction(run: (db: typeof tx) => Promise<unknown>) { return run(tx); } } as unknown as PoolQueryClient;
    const tenantId = randomUUID(), kid = randomUUID();
    const snapshot: Snapshot = { schema: 1, audit_sequence: 0, tables: Object.fromEntries(TABLES.map(table => [table, []])) as Snapshot["tables"] };
    await expect(importVault(client, { tenantId, kid }, {
      expected_tenant_id: tenantId, expected_kid: kid, migration_id: randomUUID(), source_id: randomUUID(), nonce: randomBytes(32).toString("hex"), snapshot,
    })).rejects.toMatchObject({ code: "migration_durability_unavailable", status: 503 });
    expect(statements).toHaveLength(4);
    expect(statements[2]).toBe("SET LOCAL synchronous_commit='on'");
    expect(statements[3]).toStartWith("SELECT current_setting('fsync')");
    expect(statements.some(sql => /FROM|INSERT|UPDATE|DELETE|LOCK TABLE/.test(sql))).toBe(false);
  }
});
