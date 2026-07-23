import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { QueryResultRow } from "pg";
import type { PoolQueryClient, TypedQueryClient } from "../../generated/storage-kit/query.js";
import { DuplicateWorkflowEventError } from "../errors.js";
import type { WorkflowEventRow } from "../store.js";
import { PostgresLoopStorage } from "./postgres-loop-storage.js";

const source = readFileSync(fileURLToPath(new URL("./postgres-loop-storage.ts", import.meta.url)), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const literals = [...source.matchAll(/`([\s\S]*?)`|"([^"\\]*(?:\\.[^"\\]*)*)"/g)]
  .map((match) => match[1] ?? match[2] ?? "")
  .filter((value) => /\b(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(value));
const tenantContextFunction = `${["open", "loops", "current", "tenant", "id"].join("_")}()`;

const tenantTables = [
  "loops", "loop_runs", "daemon_lease", "workflow_specs", "workflow_runs",
  "workflow_invocations", "workflow_work_items", "workflow_step_runs", "workflow_events",
  "goals", "goal_plan_nodes", "goal_runs", "runner_machines", "runner_leases", "run_receipts",
] as const;

describe("Postgres tenant SQL static guard", () => {
  test("all tenant-table reads and mutations carry an explicit tenant boundary", () => {
    const checked: string[] = [];
    for (const sql of literals) {
      for (const table of tenantTables) {
        const readsOrMutates = new RegExp(`\\b(?:FROM|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, "i").test(sql);
        if (readsOrMutates) {
          checked.push(`${table}:predicate`);
          if (sql.includes("${where}")) {
            expect(code).toContain(`const where = \`WHERE tenant_id = ${tenantContextFunction}`);
          } else {
            expect(sql, sql).toContain(`tenant_id = ${tenantContextFunction}`);
          }
        }
        const inserts = new RegExp(`\\bINSERT\\s+INTO\\s+${table}\\b`, "i").test(sql);
        if (inserts) {
          checked.push(`${table}:insert`);
          expect(sql, sql).toMatch(/\btenant_id\b/i);
          expect(sql, sql).toContain(tenantContextFunction);
        }
      }
    }
    expect(checked.length).toBeGreaterThan(80);
  });

  test("all conflict targets use tenant-qualified keys", () => {
    expect(code).not.toMatch(/ON\s+CONFLICT\s*\(\s*(?:id|run_id|loop_id|workflow_run_id|route_key)\b/i);
  });
});

describe("Postgres workflow contract event guard", () => {
  test("locks the workflow run before checking for a duplicate agent session contract", async () => {
    const events: WorkflowEventRow[] = [];
    const statements: string[] = [];
    const tx = {
      query: async <T extends QueryResultRow>() => ({ rows: [] as T[], rowCount: 0 }),
      many: async <T extends QueryResultRow>() => [] as T[],
      one: async <T extends QueryResultRow>() => { throw new Error("unexpected one()"); },
      get: async <T extends QueryResultRow>(sql: string, params: readonly unknown[] = []) => {
        statements.push(sql);
        if (sql.includes("FROM workflow_runs") && sql.includes("FOR UPDATE")) return { id: "run-1" } as unknown as T;
        if (sql.includes("event_type = $2") && sql.includes("IS NOT DISTINCT FROM $3")) {
          return (events.find((event) => event.event_type === params[1] && event.step_id === params[2]) ?? null) as T | null;
        }
        if (sql.includes("MAX(sequence)")) return { sequence: events.at(-1)?.sequence ?? null } as unknown as T;
        if (sql.includes("FROM workflow_events") && sql.includes("id = $1")) {
          return (events.find((event) => event.id === params[0]) ?? null) as T | null;
        }
        return null;
      },
      execute: async (sql: string, params: readonly unknown[] = []) => {
        statements.push(sql);
        if (!sql.includes("INSERT INTO workflow_events")) throw new Error(`unexpected execute: ${sql}`);
        events.push({
          id: String(params[0]),
          workflow_run_id: String(params[1]),
          sequence: Number(params[2]),
          event_type: String(params[3]),
          step_id: params[4] === null ? null : String(params[4]),
          payload_json: params[5] === null ? null : String(params[5]),
          created_at: String(params[6]),
        });
      },
    } satisfies TypedQueryClient;
    const client = {
      ...tx,
      pool: null as never,
      transaction: async <T>(fn: (client: TypedQueryClient) => Promise<T>) => fn(tx),
      close: async () => undefined,
    } satisfies PoolQueryClient;
    const storage = new PostgresLoopStorage(client, {
      tenantId: "tenant-test",
      principalId: "principal-test",
      requestId: "request-test",
    }, { contextAlreadyBound: true });

    await storage.appendWorkflowEvent("run-1", "agent_session_contract", "worker", { version: 1 });
    await expect(storage.appendWorkflowEvent(
      "run-1",
      "agent_session_contract",
      "worker",
      { version: 1 },
    )).rejects.toBeInstanceOf(DuplicateWorkflowEventError);

    expect(events).toHaveLength(1);
    const lockIndex = statements.findIndex((sql) => sql.includes("workflow_runs") && sql.includes("FOR UPDATE"));
    const duplicateIndex = statements.findIndex((sql) => sql.includes("IS NOT DISTINCT FROM $3"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(duplicateIndex).toBeGreaterThan(lockIndex);
  });
});
