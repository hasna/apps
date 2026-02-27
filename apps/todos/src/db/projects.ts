import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { CreateProjectInput, Project } from "../types/index.js";
import { ProjectNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function generatePrefix(name: string, db: Database): string {
  // Generate a 3-4 char uppercase prefix from the name
  const words = name.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/);
  let prefix: string;
  if (words.length >= 3) {
    prefix = words.slice(0, 3).map(w => w[0]!.toUpperCase()).join("");
  } else if (words.length === 2) {
    prefix = (words[0]!.slice(0, 2) + words[1]![0]!).toUpperCase();
  } else {
    prefix = words[0]!.slice(0, 3).toUpperCase();
  }

  // Ensure uniqueness by appending a number if needed
  let candidate = prefix;
  let suffix = 1;
  while (true) {
    const existing = db.query("SELECT id FROM projects WHERE task_prefix = ?").get(candidate);
    if (!existing) return candidate;
    suffix++;
    candidate = `${prefix}${suffix}`;
  }
}

export function createProject(
  input: CreateProjectInput,
  db?: Database,
): Project {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  const taskListId = input.task_list_id ?? `todos-${slugify(input.name)}`;
  const taskPrefix = input.task_prefix || generatePrefix(input.name, d);

  d.run(
    `INSERT INTO projects (id, name, path, description, task_list_id, task_prefix, task_counter, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, input.name, input.path, input.description || null, taskListId, taskPrefix, timestamp, timestamp],
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

export function nextTaskShortId(projectId: string, db?: Database): string | null {
  const d = db || getDatabase();
  const project = getProject(projectId, d);
  if (!project || !project.task_prefix) return null;

  d.run("UPDATE projects SET task_counter = task_counter + 1, updated_at = ? WHERE id = ?", [now(), projectId]);
  const updated = getProject(projectId, d)!;
  const padded = String(updated.task_counter).padStart(5, "0");
  return `${updated.task_prefix}-${padded}`;
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
