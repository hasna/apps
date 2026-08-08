import { describe, expect, test } from "bun:test";
import {
  TODOS_TASK_MANIFEST_ROUTE,
  createPostgresTodosTaskManifestAuthority,
  type TodosTaskManifestPostgresClient,
} from "./index.js";

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

  test("uses one parameterized bounded read-only query for exact plan binding recovery", async () => {
    const planId = "a0000000-0000-4000-8000-000000000099";
    const receiptId = "b0000000-0000-4000-8000-000000000099";
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const client: TodosTaskManifestPostgresClient = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (/^\s*SELECT\b/i.test(sql) && sql.includes("#>> '{graph,plan_id}'")) {
          return {
            rows: [{
              apply_receipt_id: receiptId,
              state: "applied",
              binding_version: 1,
              binding_tenant_id: "tenant-postgres-lookup",
              binding_operation_id: "postgres-lookup",
              binding_plan_id: planId,
              receipt_tenant_id: "tenant-postgres-lookup",
              receipt_authority: "todos",
              receipt_route: TODOS_TASK_MANIFEST_ROUTE,
              receipt_schema_version: 1,
              receipt_kind: "apply",
              receipt_operation_id: "postgres-lookup",
              receipt_plan_id: planId,
            }],
          };
        }
        return { rows: [] };
      },
      async transaction(fn) {
        return fn({ query: async () => ({ rows: [] }) });
      },
    };
    const authority = createPostgresTodosTaskManifestAuthority(client, { tenantId: "tenant-postgres-lookup" });

    expect(await authority.lookupBinding({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      tenant_id: "tenant-postgres-lookup",
      plan_id: planId,
      max_items: 1,
    })).toEqual({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      tenant_id: "tenant-postgres-lookup",
      plan_id: planId,
      apply_receipt_id: receiptId,
      binding_version: 1,
      state: "applied",
    });

    const lookup = queries.find((entry) =>
      /^\s*SELECT\b/i.test(entry.sql) && entry.sql.includes("#>> '{graph,plan_id}'")
    );
    expect(lookup?.params).toEqual(["tenant-postgres-lookup", planId]);
    expect(lookup?.sql).toMatch(/\bb\.tenant_id = \$1\b/);
    expect(lookup?.sql).toMatch(/\br\.tenant_id = b\.tenant_id\b/);
    expect(lookup?.sql).toMatch(/\bLIMIT 2\b/);
    expect(lookup?.sql).toMatch(/^\s*SELECT\b/i);
    expect(lookup?.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(lookup?.sql).not.toContain("manifest_json");
  });

  test("emits tenant-safe PostgreSQL create and legacy backfill migration statements", async () => {
    const statements: string[] = [];
    const client: TodosTaskManifestPostgresClient = {
      async query(sql) {
        statements.push(sql);
        return { rows: [] };
      },
      async transaction(fn) {
        return fn({ query: async () => ({ rows: [] }) });
      },
    };
    const authority = createPostgresTodosTaskManifestAuthority(client, {
      tenantId: "tenant-upgrade",
    });

    await expect(authority.lookupBinding({
      authority: "todos",
      route: TODOS_TASK_MANIFEST_ROUTE,
      schema_version: 1,
      tenant_id: "tenant-upgrade",
      plan_id: "a0000000-0000-4000-8000-000000000098",
      max_items: 1,
    })).rejects.toThrow();

    const schema = statements.join("\n");
    expect(schema).toMatch(/todos_task_manifest_receipts[\s\S]*tenant_id text NOT NULL/);
    expect(schema).toMatch(/todos_task_manifest_bindings[\s\S]*tenant_id text NOT NULL/);
    expect(schema).toContain(
      "ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-upgrade'",
    );
    expect(schema).toContain("ALTER COLUMN tenant_id DROP DEFAULT");
  });
});
