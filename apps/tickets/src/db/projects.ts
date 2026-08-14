import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.ts";
import type { Project } from "../types/index.ts";
import { NotFoundError, ValidationError } from "../types/index.ts";

interface RawProject {
  id: string;
  workspace_id: string | null;
  name: string;
  slug: string;
  ticket_prefix: string;
  ticket_counter: number;
  description: string | null;
  icon: string | null;
  is_public: number;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: RawProject): Project {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    slug: row.slug,
    ticket_prefix: row.ticket_prefix,
    ticket_counter: row.ticket_counter,
    description: row.description,
    icon: row.icon,
    is_public: row.is_public === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Generate a ticket prefix from project name: "Backend API" → "BAC" */
function generatePrefix(name: string, existing: string[], db: Database): string {
  // Take first letter of each word, up to 3 chars, uppercase
  const words = name.trim().split(/\s+/);
  let prefix = words
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4);
  if (prefix.length < 2) prefix = name.slice(0, 4).toUpperCase();

  // Ensure uniqueness — add number suffix if taken
  let candidate = prefix;
  let i = 2;
  while (existing.includes(candidate)) {
    candidate = `${prefix}${i}`;
    i++;
  }
  return candidate;
}

/** slugify: "Backend API" → "backend-api" */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export interface CreateProjectOptions {
  name: string;
  workspace_id?: string;
  description?: string;
  icon?: string;
  is_public?: boolean;
  ticket_prefix?: string;
  slug?: string;
}

export function createProject(options: CreateProjectOptions, db?: Database): Project {
  const database = db ?? getDatabase();
  const { name, workspace_id, description, icon, is_public = false } = options;

  if (!name.trim()) throw new ValidationError("Project name is required");

  const id = uuid();
  const slug = options.slug ?? slugify(name);
  const n = now();

  // Get existing prefixes for uniqueness check
  const existing = database
    .query<{ ticket_prefix: string }, []>("SELECT ticket_prefix FROM projects")
    .all()
    .map((r) => r.ticket_prefix);

  const prefix = options.ticket_prefix ?? generatePrefix(name, existing, database);

  database.run(
    `INSERT INTO projects
       (id, workspace_id, name, slug, ticket_prefix, ticket_counter, description, icon, is_public, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [id, workspace_id ?? null, name, slug, prefix, description ?? null, icon ?? null, is_public ? 1 : 0, n, n]
  );

  return {
    id,
    workspace_id: workspace_id ?? null,
    name,
    slug,
    ticket_prefix: prefix,
    ticket_counter: 0,
    description: description ?? null,
    icon: icon ?? null,
    is_public,
    created_at: n,
    updated_at: n,
  };
}

export function getProjectById(id: string, db?: Database): Project {
  const database = db ?? getDatabase();
  const row = database.query<RawProject, [string]>("SELECT * FROM projects WHERE id = ?").get(id);
  if (!row) throw new NotFoundError("Project", id);
  return rowToProject(row);
}

export function getProjectBySlug(slug: string, workspaceId?: string, db?: Database): Project | null {
  const database = db ?? getDatabase();
  let row: RawProject | null;
  if (workspaceId) {
    row = database.query<RawProject, [string, string]>(
      "SELECT * FROM projects WHERE slug = ? AND workspace_id = ?"
    ).get(slug, workspaceId);
  } else {
    row = database.query<RawProject, [string]>("SELECT * FROM projects WHERE slug = ?").get(slug);
  }
  return row ? rowToProject(row) : null;
}

export function listProjects(workspaceId?: string, db?: Database): Project[] {
  const database = db ?? getDatabase();
  let rows: RawProject[];
  if (workspaceId) {
    rows = database.query<RawProject, [string]>(
      "SELECT * FROM projects WHERE workspace_id = ? ORDER BY name ASC"
    ).all(workspaceId);
  } else {
    rows = database.query<RawProject, []>("SELECT * FROM projects ORDER BY name ASC").all();
  }
  return rows.map(rowToProject);
}

export interface UpdateProjectOptions {
  name?: string;
  description?: string;
  icon?: string;
  is_public?: boolean;
}

export function updateProject(id: string, options: UpdateProjectOptions, db?: Database): Project {
  const database = db ?? getDatabase();
  const project = getProjectById(id, database);

  const name = options.name ?? project.name;
  const description = options.description !== undefined ? options.description : project.description;
  const icon = options.icon !== undefined ? options.icon : project.icon;
  const is_public = options.is_public !== undefined ? options.is_public : project.is_public;
  const n = now();

  database.run(
    `UPDATE projects SET name = ?, description = ?, icon = ?, is_public = ?, updated_at = ? WHERE id = ?`,
    [name, description, icon, is_public ? 1 : 0, n, id]
  );

  return { ...project, name, description, icon, is_public, updated_at: n };
}

export function deleteProject(id: string, db?: Database): void {
  const database = db ?? getDatabase();
  const result = database.run("DELETE FROM projects WHERE id = ?", [id]);
  if (result.changes === 0) throw new NotFoundError("Project", id);
}

/** Atomically increment ticket_counter and return the new value. */
export function incrementTicketCounter(projectId: string, db?: Database): number {
  const database = db ?? getDatabase();
  database.run(
    "UPDATE projects SET ticket_counter = ticket_counter + 1 WHERE id = ?",
    [projectId]
  );
  const row = database.query<{ ticket_counter: number }, [string]>(
    "SELECT ticket_counter FROM projects WHERE id = ?"
  ).get(projectId);
  if (!row) throw new NotFoundError("Project", projectId);
  return row.ticket_counter;
}

export function getProjectStats(projectId: string, db?: Database): ProjectStats {
  const database = db ?? getDatabase();
  const rows = database.query<{ status: string; count: number }, [string]>(
    "SELECT status, COUNT(*) as count FROM tickets WHERE project_id = ? GROUP BY status"
  ).all(projectId);

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = row.count;

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    total,
    open: counts["open"] ?? 0,
    in_progress: counts["in_progress"] ?? 0,
    in_review: counts["in_review"] ?? 0,
    resolved: counts["resolved"] ?? 0,
    closed: counts["closed"] ?? 0,
  };
}

export interface ProjectStats {
  total: number;
  open: number;
  in_progress: number;
  in_review: number;
  resolved: number;
  closed: number;
}
