import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import { handleV1Request, type V1RequestDependencies } from "../server/v1.js";
import { TaskNotFoundError, VersionConflictError, type TaskHistory } from "../types/index.js";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "./cloud-client.js";
import { createLocalSqliteTodosStorageAdapter } from "./local-sqlite.js";
import { createPostgresTodosStorageAdapter } from "./postgres-adapter.js";
import { postgresTodosSyncSchemaSql, type TodosPostgresQueryClient } from "./postgres-sync.js";
import type { TodosStorageAdapter } from "./interfaces.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const SERVICE = `todos-update-audit-${process.pid}-${Date.now()}`;
const fields = (rows: TaskHistory[]) => rows.map(({ action, field, old_value, new_value, agent_id }) =>
  ({ action, field, old_value, new_value, agent_id })).sort((a, b) => a.field!.localeCompare(b.field!));

// The same observable contract runs on SQLite in ordinary CI and real PostgreSQL
// when TODOS_TEST_PG_URL identifies an isolated test database.
for (const backend of ["sqlite", "postgres"] as const) {
  describe.skipIf(backend === "postgres" && !PG_URL)(`${backend} task update audit`, () => {
    let db: Database;
    let client: TodosCloudQueryClient;
    let store: TodosStorageAdapter;
    beforeAll(async () => {
      if (backend === "sqlite") {
        db = new Database(":memory:");
        runMigrations(db);
        store = createLocalSqliteTodosStorageAdapter({ db });
      } else {
        client = createTodosCloudQueryClient(PG_URL!);
        for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
        store = createPostgresTodosStorageAdapter({ client, service: SERVICE });
      }
    });
    afterAll(async () => {
      if (backend === "sqlite") db.close();
      else {
        await client.query("DELETE FROM todos_sync_records WHERE service = $1", [SERVICE]);
        await client.close();
      }
    });

    test("records every material field with before/after values and preserves approval semantics", async () => {
      const parent = await store.tasks.create({ title: "Audit parent" });
      const task = await store.tasks.create({ title: "Before", assigned_to: "original-agent" });
      const patch = {
        version: task.version, title: "After", priority: "high" as const,
        status: "in_progress" as const, parent_id: parent.id, assigned_to: "next-agent",
        archived_at: "2026-09-18T00:00:00.000Z", working_dir: "/fixture/work",
        approved_by: "review-agent",
      };
      const updated = await store.tasks.update(task.id, patch);
      const history = (await store.audit.getTaskHistory(task.id)).filter(row => row.action !== "created");
      expect(fields(history)).toEqual(fields([
        ...(["status", "priority", "title", "parent_id", "assigned_to", "archived_at", "working_dir"] as const)
          .map(field => ({ action: "update", field, old_value: task[field], new_value: patch[field], agent_id: "original-agent" })),
        { action: "approve", field: "approved_by", old_value: null, new_value: "review-agent", agent_id: "original-agent" },
      ] as TaskHistory[]));
      expect(updated.version).toBe(task.version + 1);
      expect(new Set(history.map(row => row.id)).size).toBe(8);
      const repeated = await store.tasks.update(task.id, { ...patch, version: updated.version, approved_by: undefined });
      expect((await store.audit.getTaskHistory(task.id)).filter(row => row.action !== "created")).toHaveLength(8);
      await store.tasks.update(task.id, { version: repeated.version, parent_id: null, assigned_to: null, archived_at: null, working_dir: null });
      expect((await store.audit.getTaskHistory(task.id)).filter(row => row.action === "update" && row.new_value === null)).toHaveLength(4);
    });

    test("two priority updates produce distinct bounded history pages", async () => {
      const task = await store.tasks.create({ title: "History pagination" });
      const initialCount = (await store.audit.getTaskHistory(task.id)).length;
      const first = await store.tasks.update(task.id, { version: task.version, priority: "high" });
      await store.tasks.update(task.id, { version: first.version, priority: "low" });
      const firstPage = await store.audit.getTaskHistoryPage!(task.id, { limit: 1, offset: 0 });
      const secondPage = await store.audit.getTaskHistoryPage!(task.id, { limit: 1, offset: 1 });
      expect(firstPage.history).toHaveLength(1);
      expect(secondPage.history).toHaveLength(1);
      expect(firstPage.total).toBe(initialCount + 2);
      expect(secondPage.total).toBe(initialCount + 2);
      expect(firstPage.history[0]!.id).not.toBe(secondPage.history[0]!.id);
      expect((await store.audit.getTaskHistory(task.id)).filter(row => row.field === "priority")).toHaveLength(2);
    });

    test("version conflicts and missing parents create no audit entries", async () => {
      const task = await store.tasks.create({ title: "Rejected audit" });
      const before = await store.audit.getTaskHistory(task.id);
      await expect(Promise.resolve().then(() => store.tasks.update(task.id, { version: 0, priority: "high" }))).rejects.toBeInstanceOf(VersionConflictError);
      await expect(Promise.resolve().then(() => store.tasks.update(task.id, { version: task.version, parent_id: "absent-parent", priority: "high" }))).rejects.toBeInstanceOf(TaskNotFoundError);
      expect(await store.audit.getTaskHistory(task.id)).toEqual(before);
      expect((await store.tasks.get(task.id))!.priority).toBe("medium");
    });

    test("does not copy a secret-shaped title into audit values", async () => {
      const synthetic = ["gh", "p_"].join("") + "a".repeat(36);
      const task = await store.tasks.create({ title: "Safe audit before" });
      const updated = await store.tasks.update(task.id, { version: task.version, title: synthetic });
      await store.tasks.update(task.id, { version: updated.version, title: "Safe audit after" });
      const history = (await store.audit.getTaskHistory(task.id)).filter(row => row.field === "title");
      expect(history).toHaveLength(2);
      expect(JSON.stringify(history)).not.toContain(synthetic);
    });

    test.skipIf(backend !== "postgres")("signed /v1 PATCH attributes an unassigned task audit to its authenticated actor", async () => {
      const actor = "signed-postgres-patch-actor";
      const tenant = "tenant-update-audit";
      const signingSecret = `${randomUUID()}${randomUUID()}`;
      const key = mintApiKey({
        app: "todos",
        scopes: ["todos:read", "todos:write"],
        signingSecret,
        agent: actor,
        tid: tenant,
      });
      const verifier = verifyApiKey({
        app: "todos",
        signingSecret,
        keyStatus: async kid => kid === key.kid ? "active" : "unknown",
      });
      const task = await store.tasks.create({ title: "Signed Postgres before" });
      expect(task).toMatchObject({ assigned_to: null, agent_id: null });
      const url = new URL(`https://todos.example.test/v1/tasks/${task.id}`);
      const dependencies: V1RequestDependencies = {
        getVerifier: () => verifier,
        getMachineRegistryTenantId: () => tenant,
        ensureSchema: async () => {},
        getStorageAdapter: () => store,
      };

      const response = await handleV1Request(
        new Request(url, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${key.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: "Signed Postgres after", version: task.version }),
        }),
        url,
        dependencies,
      );

      expect(response?.status).toBe(200);
      const titleChange = (await store.audit.getTaskHistory(task.id))
        .find(row => row.action === "update" && row.field === "title");
      expect(titleChange).toMatchObject({
        old_value: "Signed Postgres before",
        new_value: "Signed Postgres after",
        agent_id: actor,
      });
    });

    test.skipIf(backend !== "postgres")("rolls the task and earlier audit entries back if a later audit insert fails", async () => {
      const task = await store.tasks.create({ title: "Atomic before" });
      let auditInserts = 0;
      const inject = (inner: TodosPostgresQueryClient): TodosPostgresQueryClient => ({
        query: async <T>(sql: string, values: readonly unknown[] = []) => {
          if (sql.includes("INSERT INTO") && values[1] === "audit_history" && ++auditInserts === 2) {
            throw new Error("injected audit persistence failure");
          }
          return inner.query<T>(sql, values);
        },
        transaction: fn => client.transaction(tx => fn(inject(tx))),
      });
      const failing = createPostgresTodosStorageAdapter({ client: inject(client), service: SERVICE });
      await expect(failing.tasks.update(task.id, { version: task.version, priority: "high", title: "Atomic after" })).rejects.toThrow("injected audit persistence failure");
      expect(auditInserts).toBe(2);
      expect(await store.tasks.get(task.id)).toEqual(task);
      expect((await store.audit.getTaskHistory(task.id)).filter(row => row.action !== "created")).toEqual([]);
    });

    test.skipIf(backend !== "postgres")("records only the winning concurrent update and keeps service boundaries", async () => {
      const task = await store.tasks.create({ title: "Concurrent audit" });
      const results = await Promise.allSettled([
        store.tasks.update(task.id, { version: task.version, priority: "high" }),
        store.tasks.update(task.id, { version: task.version, priority: "low" }),
      ]);
      expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
      const history = (await store.audit.getTaskHistory(task.id)).filter(row => row.field === "priority");
      expect(history).toHaveLength(1);
      expect(history[0]!.new_value).toBe((await store.tasks.get(task.id))!.priority);
      const other = createPostgresTodosStorageAdapter({ client, service: `${SERVICE}-other` });
      expect(await other.audit.getTaskHistory(task.id)).toEqual([]);
      await expect(other.tasks.update(task.id, { version: 2, priority: "critical" })).rejects.toBeInstanceOf(TaskNotFoundError);
    });
  });
}
