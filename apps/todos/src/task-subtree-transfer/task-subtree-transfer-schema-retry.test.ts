import { describe, expect, test } from "bun:test";
import { createPostgresTodosTaskSubtreeTransferAuthority } from "./authority.js";
import type { TodosTaskSubtreeTransferPostgresClient } from "./types.js";

/**
 * Regression test for incident 724661 (2026-08-22): the task-subtree-transfer
 * backend's `ensureSchema()` cached the rejected `schemaReady` promise
 * forever, so a transient schema-sync failure (e.g. a DDL lock timeout) was
 * replayed on every later operation — each one failing instantly with no DB
 * round trip. Same defect class as the storage adapter (PR #931) and the
 * pr-groups / project-registration backends (PR #933); this backend is wired
 * into the same process via the cached singleton in server/cloud.ts.
 */
describe("task-subtree-transfer postgres ensureSchema recovery", () => {
  const SOURCE_PROJECT_ID = "11000000-0000-4000-8000-000000000001";
  const DESTINATION_PROJECT_ID = "22000000-0000-4000-8000-000000000002";
  const DESTINATION_TASK_LIST_ID = "33000000-0000-4000-8000-000000000003";
  const DESTINATION_PARENT_ID = "44000000-0000-4000-8000-000000000004";
  const ROOT_TASK_ID = "55000000-0000-4000-8000-000000000005";
  const NOW = "2026-08-18T20:00:00.000Z";

  const inspectInput = {
    source_project_id: SOURCE_PROJECT_ID,
    destination_project_id: DESTINATION_PROJECT_ID,
    destination_task_list_id: DESTINATION_TASK_LIST_ID,
    root_task_id: ROOT_TASK_ID,
    destination_parent_id: DESTINATION_PARENT_ID,
  };

  function schemaDdl(sql: string): boolean {
    return (
      sql.includes("CREATE TABLE IF NOT EXISTS")
      || sql.includes("CREATE TRIGGER")
      || sql.includes("CREATE OR REPLACE FUNCTION")
      || sql.includes("DROP TRIGGER IF EXISTS")
    );
  }

  test("a failed schema sync is retried on the next operation instead of being cached forever", async () => {
    let queryCalls = 0;
    const client: TodosTaskSubtreeTransferPostgresClient = {
      async query(sql: string) {
        queryCalls += 1;
        if (queryCalls === 1) {
          const error = new Error("canceling statement due to lock timeout") as Error & {
            errno?: string;
          };
          error.errno = "55P03";
          throw error;
        }
        if (sql.includes("LIMIT 1")) return { rows: [{}] };
        if (sql.includes("payload->>'project_id' = $2")) {
          return {
            rows: [{
              object_id: ROOT_TASK_ID,
              payload: JSON.stringify({
                id: ROOT_TASK_ID,
                project_id: SOURCE_PROJECT_ID,
                parent_id: null,
                plan_id: null,
                task_list_id: null,
                version: 1,
                updated_at: NOW,
              }),
              updated_at: NOW,
              version: 1,
            }],
          };
        }
        return { rows: [] };
      },
      async transaction<T>(fn) {
        return fn(this);
      },
    };
    const authority = createPostgresTodosTaskSubtreeTransferAuthority(client, {
      service: "schema-retry-test",
      tenantId: "schema-retry-test",
    });

    // The first operation surfaces the schema-sync failure.
    await expect(authority.inspect(inspectInput)).rejects.toThrow(
      "canceling statement due to lock timeout",
    );

    // The failure must NOT be cached: the next operation re-runs the schema
    // sync (which now succeeds) and completes normally.
    await expect(authority.inspect(inspectInput)).resolves.toMatchObject({
      complete: true,
      expected_tasks: [{ task_id: ROOT_TASK_ID, version: 1 }],
    });
  });

  test("a successful schema sync stays cached across operations", async () => {
    let ddlCalls = 0;
    const client: TodosTaskSubtreeTransferPostgresClient = {
      async query(sql: string) {
        if (schemaDdl(sql)) ddlCalls += 1;
        if (sql.includes("LIMIT 1")) return { rows: [{}] };
        if (sql.includes("payload->>'project_id' = $2")) {
          return {
            rows: [{
              object_id: ROOT_TASK_ID,
              payload: JSON.stringify({
                id: ROOT_TASK_ID,
                project_id: SOURCE_PROJECT_ID,
                parent_id: null,
                plan_id: null,
                task_list_id: null,
                version: 1,
                updated_at: NOW,
              }),
              updated_at: NOW,
              version: 1,
            }],
          };
        }
        return { rows: [] };
      },
      async transaction<T>(fn) {
        return fn(this);
      },
    };
    const authority = createPostgresTodosTaskSubtreeTransferAuthority(client, {
      service: "schema-retry-test",
      tenantId: "schema-retry-test",
    });

    await expect(authority.inspect(inspectInput)).resolves.toMatchObject({
      complete: true,
    });
    const ddlCallsAfterFirst = ddlCalls;
    expect(ddlCallsAfterFirst).toBeGreaterThan(0);

    await expect(authority.inspect(inspectInput)).resolves.toMatchObject({
      complete: true,
    });

    // The schema sync runs exactly once; the second operation reuses the
    // resolved promise instead of re-issuing the schema statements.
    expect(ddlCalls).toBe(ddlCallsAfterFirst);
  });
});
