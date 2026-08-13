import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { Project } from "../types/index.js";
import { NotFoundError, DuplicateError } from "../types/index.js";

function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    slug: row["slug"] as string,
    description: row["description"] as string | undefined,
    color: row["color"] as string | undefined,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  };
}

export function createProject(data: {
  name: string;
  slug?: string;
  description?: string;
  color?: string;
}): Project {
  const db = getDatabase();
  const id = `prj-${nanoid(8)}`;
  const slug = data.slug ?? makeSlug(data.name);

  const existing = db
    .query<{ id: string }, [string]>("SELECT id FROM projects WHERE slug = ?")
    .get(slug);
  if (existing) {
    throw new DuplicateError("Project", "slug", slug);
  }

  db.query(
    `INSERT INTO projects (id, name, slug, description, color)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, data.name, slug, data.description ?? null, data.color ?? null);

  return getProjectById(id);
}

export function getProjectById(id: string): Project {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM projects WHERE id = ?"
    )
    .get(id);
  if (!row) throw new NotFoundError("Project", id);
  return rowToProject(row);
}

export function getProjectBySlug(slug: string): Project {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM projects WHERE slug = ?"
    )
    .get(slug);
  if (!row) throw new NotFoundError("Project", slug);
  return rowToProject(row);
}

export function listProjects(): Project[] {
  const db = getDatabase();
  const rows = db
    .query<Record<string, unknown>, []>(
      "SELECT * FROM projects ORDER BY created_at DESC"
    )
    .all();
  return rows.map(rowToProject);
}

export function updateProject(
  id: string,
  data: Partial<Pick<Project, "name" | "slug" | "description" | "color">>
): Project {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM projects WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("Project", id);

  const fields: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.slug !== undefined) { fields.push("slug = ?"); values.push(data.slug); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.color !== undefined) { fields.push("color = ?"); values.push(data.color); }

  values.push(id);
  db.query(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...(values as [string]));
  return getProjectById(id);
}

export function deleteProject(id: string): void {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM projects WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("Project", id);
  db.query("DELETE FROM projects WHERE id = ?").run(id);
}
