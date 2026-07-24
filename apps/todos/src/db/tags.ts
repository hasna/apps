import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  task_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  description?: string;
}

export interface UpdateTagInput {
  name?: string;
  color?: string;
  description?: string;
}

interface TagRow {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeName(name: string): string {
  return name.trim();
}

function taskCount(name: string, db: Database): number {
  const row = db.query("SELECT COUNT(*) AS count FROM task_tags WHERE tag = ?").get(name) as { count: number } | null;
  return row?.count ?? 0;
}

function rowToTag(row: TagRow, db: Database): Tag {
  return {
    ...row,
    task_count: taskCount(row.name, db),
  };
}

function virtualTag(name: string, db: Database): Tag {
  return {
    id: name,
    name,
    color: null,
    description: null,
    task_count: taskCount(name, db),
    created_at: null,
    updated_at: null,
  };
}

function getTagRow(idOrName: string, db: Database): TagRow | null {
  return db.query("SELECT * FROM tags WHERE id = ?").get(idOrName) as TagRow | null
    ?? db.query("SELECT * FROM tags WHERE lower(name) = lower(?)").get(idOrName) as TagRow | null;
}

function updateTaskTagJson(oldName: string, newName: string | null, db: Database): void {
  const rows = db.query("SELECT id, tags FROM tasks WHERE tags IS NOT NULL AND tags != '[]'").all() as { id: string; tags: string | null }[];
  const update = db.prepare("UPDATE tasks SET tags = ?, updated_at = ? WHERE id = ?");
  const ts = now();
  for (const row of rows) {
    if (!row.tags) continue;
    let tags: string[];
    try {
      tags = JSON.parse(row.tags) as string[];
    } catch {
      continue;
    }
    if (!tags.includes(oldName)) continue;
    const next = newName
      ? Array.from(new Set(tags.map((tag) => tag === oldName ? newName : tag)))
      : tags.filter((tag) => tag !== oldName);
    update.run(JSON.stringify(next), ts, row.id);
  }
}

function renameTaskTagRows(oldName: string, newName: string, db: Database): void {
  const rows = db.query("SELECT task_id FROM task_tags WHERE tag = ?").all(oldName) as { task_id: string }[];
  const insert = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)");
  for (const row of rows) insert.run(row.task_id, newName);
  db.run("DELETE FROM task_tags WHERE tag = ?", [oldName]);
}

export function createTag(input: CreateTagInput, db?: Database): Tag {
  const d = getDatabase(db);
  const name = normalizeName(input.name);
  if (!name) throw new Error("Tag name is required");
  const id = uuid();
  const ts = now();
  d.run(
    `INSERT INTO tags (id, name, color, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, input.color ?? null, input.description ?? null, ts, ts],
  );
  return rowToTag(d.query("SELECT * FROM tags WHERE id = ?").get(id) as TagRow, d);
}

export function listTags(db?: Database): Tag[] {
  const d = getDatabase(db);
  const rows = d.query("SELECT * FROM tags ORDER BY name").all() as TagRow[];
  const tagsByName = new Map(rows.map((row) => [row.name.toLowerCase(), rowToTag(row, d)]));
  const taskTags = d.query("SELECT tag, COUNT(*) AS count FROM task_tags GROUP BY tag ORDER BY tag").all() as { tag: string; count: number }[];
  for (const row of taskTags) {
    const key = row.tag.toLowerCase();
    if (!tagsByName.has(key)) tagsByName.set(key, { ...virtualTag(row.tag, d), task_count: row.count });
  }
  return [...tagsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getTag(idOrName: string, db?: Database): Tag | null {
  const d = getDatabase(db);
  const row = getTagRow(idOrName, d);
  if (row) return rowToTag(row, d);
  const existing = d.query("SELECT tag FROM task_tags WHERE lower(tag) = lower(?) LIMIT 1").get(idOrName) as { tag: string } | null;
  return existing ? virtualTag(existing.tag, d) : null;
}

export function updateTag(idOrName: string, input: UpdateTagInput, db?: Database): Tag {
  const d = getDatabase(db);
  const existing = getTag(idOrName, d);
  if (!existing) throw new Error(`Tag not found: ${idOrName}`);

  const row = getTagRow(existing.id, d);
  if (!row) createTag({ name: existing.name, color: existing.color ?? undefined, description: existing.description ?? undefined }, d);

  const stored = getTagRow(existing.id, d) ?? getTagRow(existing.name, d);
  if (!stored) throw new Error(`Tag not found: ${idOrName}`);

  const nextName = input.name !== undefined ? normalizeName(input.name) : stored.name;
  if (!nextName) throw new Error("Tag name is required");
  const duplicate = getTagRow(nextName, d);
  if (duplicate && duplicate.id !== stored.id) throw new Error(`Tag already exists: ${nextName}`);

  if (nextName !== stored.name) {
    renameTaskTagRows(stored.name, nextName, d);
    updateTaskTagJson(stored.name, nextName, d);
  }

  d.run(
    `UPDATE tags SET name = ?, color = COALESCE(?, color), description = COALESCE(?, description), updated_at = ? WHERE id = ?`,
    [nextName, input.color ?? null, input.description ?? null, now(), stored.id],
  );
  return getTag(stored.id, d)!;
}

export function deleteTag(idOrName: string, db?: Database): boolean {
  const d = getDatabase(db);
  const existing = getTag(idOrName, d);
  if (!existing) return false;
  d.run("DELETE FROM tags WHERE id = ? OR lower(name) = lower(?)", [existing.id, existing.name]);
  d.run("DELETE FROM task_tags WHERE tag = ?", [existing.name]);
  updateTaskTagJson(existing.name, null, d);
  return true;
}
