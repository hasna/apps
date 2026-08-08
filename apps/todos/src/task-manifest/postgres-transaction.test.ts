import { describe, expect, test } from "bun:test";
import { createPostgresTodosTaskManifestAuthority, type TodosTaskManifestPostgresClient } from "./index.js";

describe("task-manifest PostgreSQL transaction contract", () => {
  test("requires and uses the authoritative transaction callback for every graph write", async () => {
    const rootWrites: string[] = [];
    const transactionWrites: string[] = [];
    let transactions = 0;
    const client: TodosTaskManifestPostgresClient = {
      async query(sql) {
        if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) rootWrites.push(sql);
        return { rows: [] };
      },
      async transaction(fn) {
        transactions += 1;
        return fn({
          async query(sql) {
            if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) transactionWrites.push(sql);
            if (sql.includes("object_type = 'projects'")) return { rows: [{ found: 1 }] };
            return { rows: [] };
          },
        });
      },
    };
    const authority = createPostgresTodosTaskManifestAuthority(client, {
      service: "manifest-transaction-test",
      faultInjector: (point) => point === "after_verification_write",
    });
    await expect(authority.apply({
      version: 1,
      operation_id: "postgres-transaction-callback-test",
      idempotency_key: "postgres-transaction-callback-test:apply",
      project_id: "a0000000-0000-4000-8000-000000000001",
      plan: { key: "callback", name: "Callback" },
      tasks: [{ key: "one", title: "One", verifications: [{ command: "one" }] }],
    })).rejects.toThrow(/after_verification_write/);
    expect(transactions).toBe(1);
    expect(transactionWrites.length).toBeGreaterThanOrEqual(3);
    expect(rootWrites).toEqual([]);
  });

  test("fails closed when a client has no transaction callback", () => {
    expect(() => createPostgresTodosTaskManifestAuthority({
      query: async () => ({ rows: [] }),
    } as TodosTaskManifestPostgresClient)).toThrow(/transaction\(callback\)/);
  });
});
