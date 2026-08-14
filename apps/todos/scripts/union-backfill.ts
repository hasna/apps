/**
 * union-backfill: import the missing tasks (fleet-union delta) into cloud via POST /v1/import.
 * Reads one or more local sqlite DBs, exports each with the canonical snapshot exporter,
 * keeps only tasks whose id is in the missing-ids file, and posts them (plus their projects,
 * plans and taskLists for referential completeness) to the cloud /v1/import endpoint.
 *
 * Usage: bun scripts/union-backfill.ts <missing-ids-file> <db1> [db2 ...]
 * Env:   TK=<bearer key>  TODOS_API=https://your-server.example/v1
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { listTasks } from "../src/db/task-crud.js";
import { listProjects } from "../src/db/projects.js";
import { listPlans } from "../src/db/plans.js";
import { listTaskLists } from "../src/db/task-lists.js";

const TK = process.env.TK;
const API = process.env.TODOS_API ?? "https://your-server.example/v1";
if (!TK) { console.error("missing TK env"); process.exit(1); }

const missingFile = process.argv[2];
const dbPaths = process.argv.slice(3);
const missing = new Set(readFileSync(missingFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean));
console.log(`missing target ids: ${missing.size}; source dbs: ${dbPaths.length}`);

const tasksById = new Map<string, unknown>();
const projectsById = new Map<string, unknown>();
const plansById = new Map<string, unknown>();
const taskListsById = new Map<string, unknown>();

for (const p of dbPaths) {
  const db = new Database(p); // writable copy: listTasks clears expired locks (never run on originals)
  const proj = new Map((listProjects(db) as { id: string }[]).map((x) => [x.id, x]));
  const plans = new Map((listPlans(undefined, db) as { id: string }[]).map((x) => [x.id, x]));
  const tls = new Map((listTaskLists(undefined, db) as { id: string }[]).map((x) => [x.id, x]));
  let hit = 0;
  for (const t of listTasks({ include_archived: true }, db) as { id: string; project_id?: string; plan_id?: string; task_list_id?: string }[]) {
    if (!missing.has(t.id) || tasksById.has(t.id)) continue;
    tasksById.set(t.id, t);
    hit++;
    if (t.project_id && proj.has(t.project_id)) projectsById.set(t.project_id, proj.get(t.project_id));
    if (t.plan_id && plans.has(t.plan_id)) plansById.set(t.plan_id, plans.get(t.plan_id));
    if (t.task_list_id && tls.has(t.task_list_id)) taskListsById.set(t.task_list_id, tls.get(t.task_list_id));
  }
  db.close();
  console.log(`  ${p}: matched ${hit} missing tasks`);
}

const payload = {
  source: "sqlite",
  tasks: [...tasksById.values()],
  projects: [...projectsById.values()],
  plans: [...plansById.values()],
  taskLists: [...taskListsById.values()],
};
console.log(`posting: tasks=${payload.tasks.length} projects=${payload.projects.length} plans=${payload.plans.length} taskLists=${payload.taskLists.length}`);
if (payload.tasks.length === 0) { console.log("nothing to import"); process.exit(0); }

const r = await fetch(`${API}/import`, {
  method: "POST",
  headers: { authorization: `Bearer ${TK}`, "content-type": "application/json" },
  body: JSON.stringify(payload),
});
console.log("HTTP", r.status);
console.log(await r.text());
if (!r.ok) process.exit(1);
