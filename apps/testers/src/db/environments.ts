import { getDatabase, uuid, now } from "./database.js";

interface EnvironmentRow {
  id: string;
  name: string;
  url: string;
  auth_preset_name: string | null;
  project_id: string | null;
  is_default: number;
  metadata: string;
  created_at: string;
}

export interface Environment {
  id: string;
  name: string;
  url: string;
  authPresetName: string | null;
  projectId: string | null;
  isDefault: boolean;
  variables: Record<string, string>;
  createdAt: string;
}

function fromRow(row: EnvironmentRow): Environment {
  let variables: Record<string, string> = {};
  try {
    const meta = JSON.parse(row.metadata || "{}");
    variables = meta.variables ?? {};
  } catch {
    // ignore parse errors
  }
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    authPresetName: row.auth_preset_name,
    projectId: row.project_id,
    isDefault: row.is_default === 1,
    variables,
    createdAt: row.created_at,
  };
}

export function createEnvironment(input: {
  name: string;
  url: string;
  authPresetName?: string;
  projectId?: string;
  isDefault?: boolean;
  variables?: Record<string, string>;
}): Environment {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();
  const meta = JSON.stringify({ variables: input.variables ?? {} });

  db.query(`
    INSERT INTO environments (id, name, url, auth_preset_name, project_id, is_default, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.url,
    input.authPresetName ?? null,
    input.projectId ?? null,
    input.isDefault ? 1 : 0,
    meta,
    timestamp,
  );

  return getEnvironmentById(id)!;
}

export function getEnvironmentById(id: string): Environment | null {
  const db = getDatabase();
  const row = db
    .query("SELECT * FROM environments WHERE id = ?")
    .get(id) as EnvironmentRow | null;
  return row ? fromRow(row) : null;
}

export function updateEnvironment(id: string, input: {
  name?: string;
  url?: string;
  isDefault?: boolean;
  variables?: Record<string, string>;
}): Environment {
  const db = getDatabase();
  const existing = getEnvironmentById(id);
  if (!existing) throw new Error(`Environment not found: ${id}`);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.url !== undefined) { fields.push("url = ?"); values.push(input.url); }
  if (input.isDefault !== undefined) { fields.push("is_default = ?"); values.push(input.isDefault ? 1 : 0); }
  if (input.variables !== undefined) {
    const existingMeta = { variables: existing.variables };
    existingMeta.variables = input.variables;
    fields.push("metadata = ?");
    values.push(JSON.stringify(existingMeta));
  }

  if (fields.length > 0) {
    values.push(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.query(`UPDATE environments SET ${fields.join(", ")} WHERE id = ?`) as any).run(...values);
  }

  return getEnvironmentById(id)!;
}

export function deleteEnvironmentById(id: string): boolean {
  const db = getDatabase();
  const result = db.query("DELETE FROM environments WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getEnvironment(name: string): Environment | null {
  const db = getDatabase();
  const row = db
    .query("SELECT * FROM environments WHERE name = ?")
    .get(name) as EnvironmentRow | null;
  return row ? fromRow(row) : null;
}

export function listEnvironments(projectId?: string): Environment[] {
  const db = getDatabase();
  if (projectId) {
    const rows = db
      .query("SELECT * FROM environments WHERE project_id = ? ORDER BY is_default DESC, created_at DESC")
      .all(projectId) as EnvironmentRow[];
    return rows.map(fromRow);
  }
  const rows = db
    .query("SELECT * FROM environments ORDER BY is_default DESC, created_at DESC")
    .all() as EnvironmentRow[];
  return rows.map(fromRow);
}

export function deleteEnvironment(name: string): boolean {
  const db = getDatabase();
  const result = db
    .query("DELETE FROM environments WHERE name = ?")
    .run(name);
  return result.changes > 0;
}

export function setDefaultEnvironment(name: string): void {
  const db = getDatabase();
  db.exec("UPDATE environments SET is_default = 0");
  const result = db
    .query("UPDATE environments SET is_default = 1 WHERE name = ?")
    .run(name);
  if (result.changes === 0) {
    throw new Error(`Environment not found: ${name}`);
  }
}

export function getDefaultEnvironment(): Environment | null {
  const db = getDatabase();
  const row = db
    .query("SELECT * FROM environments WHERE is_default = 1 LIMIT 1")
    .get() as EnvironmentRow | null;
  return row ? fromRow(row) : null;
}
