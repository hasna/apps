import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { CreatePlanInput, Plan, UpdatePlanInput } from "../types/index.js";
import { PlanNotFoundError } from "../types/index.js";
import { databasePathFromDatabase } from "../lib/event-emission-safety.js";
import { emitLocalEventHooksQuiet } from "../lib/event-hooks.js";
import { getDatabase, now, uuid } from "./database.js";
import { slugify } from "./projects.js";
import { currentStorageMachineId, recordStorageTombstone } from "./storage-tombstones.js";

export interface ResolvePlanRefResult {
  id: string | null;
  reason: "id" | "slug" | "not_found" | "ambiguous";
  matches: Plan[];
}

function planSlugBase(value: string): string {
  return slugify(value) || "plan";
}

export function normalizePlanSlug(value: string): string {
  const slug = slugify(value);
  if (!slug) throw new Error("Invalid plan slug");
  return slug;
}

function plansBySlug(slug: string, db: Database, projectId?: string | null): Plan[] {
  if (projectId !== undefined) {
    if (projectId === null) {
      return db.query("SELECT * FROM plans WHERE slug = ? AND project_id IS NULL ORDER BY created_at ASC, id ASC").all(slug) as Plan[];
    }
    return db.query("SELECT * FROM plans WHERE slug = ? AND project_id = ? ORDER BY created_at ASC, id ASC").all(slug, projectId) as Plan[];
  }
  return db.query("SELECT * FROM plans WHERE slug = ? ORDER BY created_at ASC, id ASC").all(slug) as Plan[];
}

function planSlugExists(slug: string, projectId: string | null, db: Database, excludeId?: string): boolean {
  const rows = plansBySlug(slug, db, projectId);
  return rows.some((plan) => plan.id !== excludeId);
}

function nextPlanSlug(base: string, projectId: string | null, db: Database, excludeId?: string): string {
  let candidate = base;
  let suffix = 2;
  while (planSlugExists(candidate, projectId, db, excludeId)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function resolveCreateSlug(input: CreatePlanInput, projectId: string | null, db: Database): string {
  if (input.slug !== undefined) {
    const slug = normalizePlanSlug(input.slug);
    if (planSlugExists(slug, projectId, db)) {
      throw new Error(`Plan slug already exists in this scope: ${slug}`);
    }
    return slug;
  }
  return nextPlanSlug(planSlugBase(input.name), projectId, db);
}

export function resolvePlanRefDetailed(ref: string, db?: Database, projectId?: string | null): ResolvePlanRefResult {
  const d = getDatabase(db);
  const byId = d.query("SELECT * FROM plans WHERE id = ? OR id LIKE ? ORDER BY id").all(ref, `${ref}%`) as Plan[];
  if (byId.length === 1) return { id: byId[0]!.id, reason: "id", matches: byId };
  if (byId.length > 1) return { id: null, reason: "ambiguous", matches: byId };

  const slug = slugify(ref);
  if (!slug) return { id: null, reason: "not_found", matches: [] };

  const bySlug = plansBySlug(slug, d, projectId);
  if (bySlug.length === 1) return { id: bySlug[0]!.id, reason: "slug", matches: bySlug };
  if (bySlug.length > 1) return { id: null, reason: "ambiguous", matches: bySlug };
  return { id: null, reason: "not_found", matches: [] };
}

export function resolvePlanRef(ref: string, db?: Database, projectId?: string | null): string | null {
  return resolvePlanRefDetailed(ref, db, projectId).id;
}

export function createPlan(input: CreatePlanInput, db?: Database): Plan {
  const d = getDatabase(db);
  const id = uuid();
  const timestamp = now();
  const projectId = input.project_id || null;
  const slug = resolveCreateSlug(input, projectId, d);
  const machineId = currentStorageMachineId(d);

  d.run(
    `INSERT INTO plans (id, slug, project_id, task_list_id, agent_id, name, description, status, created_at, updated_at, machine_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      slug,
      projectId,
      input.task_list_id || null,
      input.agent_id || null,
      input.name,
      input.description || null,
      input.status || "active",
      timestamp,
      timestamp,
      machineId,
    ],
  );

  return getPlan(id, d)!;
}

export function getPlan(id: string, db?: Database): Plan | null {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM plans WHERE id = ?").get(id) as Plan | null;
  return row;
}

export function listPlans(projectId?: string, db?: Database): Plan[] {
  const d = getDatabase(db);
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
  const d = getDatabase(db);
  const plan = getPlan(id, d);
  if (!plan) throw new PlanNotFoundError(id);

  const sets: string[] = ["updated_at = ?"];
  const params: SQLQueryBindings[] = [now()];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.slug !== undefined) {
    const slug = normalizePlanSlug(input.slug);
    if (planSlugExists(slug, plan.project_id, d, id)) {
      throw new Error(`Plan slug already exists in this scope: ${slug}`);
    }
    sets.push("slug = ?");
    params.push(slug);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.task_list_id !== undefined) {
    sets.push("task_list_id = ?");
    params.push(input.task_list_id);
  }
  if (input.agent_id !== undefined) {
    sets.push("agent_id = ?");
    params.push(input.agent_id);
  }

  params.push(id);
  d.run(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`, params);

  const updated = getPlan(id, d)!;
  emitLocalEventHooksQuiet({
    type: "plan.updated",
    payload: { id, old_status: plan.status, new_status: updated.status, name: updated.name, project_id: updated.project_id },
    databasePath: databasePathFromDatabase(d),
  });
  return updated;
}

export function deletePlan(id: string, db?: Database): boolean {
  const d = getDatabase(db);
  const plan = getPlan(id, d);
  if (!plan) return false;
  recordStorageTombstone({
    object_type: "plans",
    object_id: id,
    payload: plan as unknown as Record<string, unknown>,
  }, d);
  const result = d.run("DELETE FROM plans WHERE id = ?", [id]);
  return result.changes > 0;
}
