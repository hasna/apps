import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { CreatePlanInput, Plan, UpdatePlanInput } from "../types/index.js";
import { PlanNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function createPlan(input: CreatePlanInput, db?: Database): Plan {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO plans (id, project_id, name, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.project_id || null,
      input.name,
      input.description || null,
      input.status || "active",
      timestamp,
      timestamp,
    ],
  );

  return getPlan(id, d)!;
}

export function getPlan(id: string, db?: Database): Plan | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM plans WHERE id = ?").get(id) as Plan | null;
  return row;
}

export function listPlans(projectId?: string, db?: Database): Plan[] {
  const d = db || getDatabase();
  if (projectId) {
    return d
      .query("SELECT * FROM plans WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Plan[];
  }
  return d
    .query("SELECT * FROM plans ORDER BY created_at DESC")
    .all() as Plan[];
}

export function updatePlan(
  id: string,
  input: UpdatePlanInput,
  db?: Database,
): Plan {
  const d = db || getDatabase();
  const plan = getPlan(id, d);
  if (!plan) throw new PlanNotFoundError(id);

  const sets: string[] = ["updated_at = ?"];
  const params: SQLQueryBindings[] = [now()];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }

  params.push(id);
  d.run(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`, params);

  return getPlan(id, d)!;
}

export function deletePlan(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM plans WHERE id = ?", [id]);
  return result.changes > 0;
}
