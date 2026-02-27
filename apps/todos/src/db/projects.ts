import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { CreateProjectInput, Project } from "../types/index.js";
import { ProjectNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function createProject(
  input: CreateProjectInput,
  db?: Database,
): Project {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  const taskListId = input.task_list_id ?? `todos-${slugify(input.name)}`;

  d.run(
    `INSERT INTO projects (id, name, path, description, task_list_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.path, input.description || null, taskListId, timestamp, timestamp],
  );

  return getProject(id, d)!;
}

export function getProject(id: string, db?: Database): Project | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM projects WHERE id = ?").get(id) as Project | null;
  return row;
}

export function getProjectByPath(path: string, db?: Database): Project | null {
  const d = db || getDatabase();
  const row = d
    .query("SELECT * FROM projects WHERE path = ?")
    .get(path) as Project | null;
  return row;
}

export function listProjects(db?: Database): Project[] {
  const d = db || getDatabase();
  return d
    .query("SELECT * FROM projects ORDER BY name")
    .all() as Project[];
}

export function updateProject(
  id: string,
  input: Partial<Pick<Project, "name" | "description" | "task_list_id">>,
  db?: Database,
): Project {
  const d = db || getDatabase();
  const project = getProject(id, d);
  if (!project) throw new ProjectNotFoundError(id);

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
  if (input.task_list_id !== undefined) {
    sets.push("task_list_id = ?");
    params.push(input.task_list_id);
  }

  params.push(id);
  d.run(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, params);

  return getProject(id, d)!;
}

export function deleteProject(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM projects WHERE id = ?", [id]);
  return result.changes > 0;
}

export function ensureProject(
  name: string,
  path: string,
  db?: Database,
): Project {
  const d = db || getDatabase();
  const existing = getProjectByPath(path, d);
  if (existing) return existing;
  return createProject({ name, path }, d);
}
