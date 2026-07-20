import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./postgres-loop-storage.ts", import.meta.url)), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const literals = [...source.matchAll(/`([\s\S]*?)`|"([^"\\]*(?:\\.[^"\\]*)*)"/g)]
  .map((match) => match[1] ?? match[2] ?? "")
  .filter((value) => /\b(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(value));

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
            expect(code).toContain("const where = `WHERE tenant_id = open_loops_current_tenant_id()");
          } else {
            expect(sql, sql).toContain("tenant_id = open_loops_current_tenant_id()");
          }
        }
        const inserts = new RegExp(`\\bINSERT\\s+INTO\\s+${table}\\b`, "i").test(sql);
        if (inserts) {
          checked.push(`${table}:insert`);
          expect(sql, sql).toMatch(/\btenant_id\b/i);
          expect(sql, sql).toContain("open_loops_current_tenant_id()");
        }
      }
    }
    expect(checked.length).toBeGreaterThan(80);
  });

  test("all conflict targets use tenant-qualified keys", () => {
    expect(code).not.toMatch(/ON\s+CONFLICT\s*\(\s*(?:id|run_id|loop_id|workflow_run_id|route_key)\b/i);
  });
});
