import { getDatabase, uuid, now } from "./database.js";

interface AuthPresetRow {
  id: string;
  name: string;
  email: string;
  password: string;
  login_path: string;
  metadata: string;
  created_at: string;
}

interface AuthPreset {
  id: string;
  name: string;
  email: string;
  password: string;
  loginPath: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

function fromRow(row: AuthPresetRow): AuthPreset {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    loginPath: row.login_path,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
  };
}

export function createAuthPreset(input: {
  name: string;
  email: string;
  password: string;
  loginPath?: string;
}): AuthPreset {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO auth_presets (id, name, email, password, login_path, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, '{}', ?)
  `).run(id, input.name, input.email, input.password, input.loginPath ?? "/login", timestamp);

  return getAuthPreset(input.name)!;
}

export function getAuthPreset(name: string): AuthPreset | null {
  const db = getDatabase();
  const row = db
    .query("SELECT * FROM auth_presets WHERE name = ?")
    .get(name) as AuthPresetRow | null;
  return row ? fromRow(row) : null;
}

export function listAuthPresets(): AuthPreset[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT * FROM auth_presets ORDER BY created_at DESC")
    .all() as AuthPresetRow[];
  return rows.map(fromRow);
}

export function deleteAuthPreset(name: string): boolean {
  const db = getDatabase();
  const result = db
    .query("DELETE FROM auth_presets WHERE name = ?")
    .run(name);
  return result.changes > 0;
}
