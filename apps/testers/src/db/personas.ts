import {
  type Persona,
  type PersonaRow,
  type PersonaFilter,
  type CreatePersonaInput,
  type UpdatePersonaInput,
  personaFromRow,
  PersonaNotFoundError,
  VersionConflictError,
} from "../types/index.js";
import { getDatabase, now, uuid, shortUuid } from "./database.js";

export function createPersona(input: CreatePersonaInput): Persona {
  const db = getDatabase();
  const id = uuid();
  const short_id = shortUuid();
  const timestamp = now();

  db.query(`
    INSERT INTO personas (id, short_id, project_id, name, description, role, instructions, traits, goals, behaviors, expertise_level, demographics, pain_points, metadata, enabled, auth_email, auth_password, auth_login_path, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    short_id,
    input.projectId ?? null,
    input.name,
    input.description ?? "",
    input.role,
    input.instructions ?? "",
    JSON.stringify(input.traits ?? []),
    JSON.stringify(input.goals ?? []),
    JSON.stringify(input.behaviors ?? []),
    input.expertiseLevel ?? "intermediate",
    JSON.stringify(input.demographics ?? {}),
    JSON.stringify(input.painPoints ?? []),
    input.metadata ? JSON.stringify(input.metadata) : "{}",
    input.enabled === false ? 0 : 1,
    input.authEmail ?? null,
    input.authPassword ?? null,
    input.authLoginPath ?? null,
    timestamp,
    timestamp,
  );

  return getPersona(id)!;
}

export function getPersona(id: string): Persona | null {
  const db = getDatabase();

  // Direct ID lookup
  let row = db.query("SELECT * FROM personas WHERE id = ?").get(id) as PersonaRow | null;
  if (row) return personaFromRow(row);

  // Try short_id lookup
  row = db.query("SELECT * FROM personas WHERE short_id = ?").get(id) as PersonaRow | null;
  if (row) return personaFromRow(row);

  return null;
}

export function listPersonas(filter?: PersonaFilter): Persona[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter?.globalOnly) {
    conditions.push("project_id IS NULL");
  } else if (filter?.projectId) {
    // Include both project-specific and global personas
    conditions.push("(project_id = ? OR project_id IS NULL)");
    params.push(filter.projectId);
  }

  if (filter?.enabled !== undefined) {
    conditions.push("enabled = ?");
    params.push(filter.enabled ? 1 : 0);
  }

  let sql = "SELECT * FROM personas";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (filter?.limit) {
    sql += " LIMIT ?";
    params.push(filter.limit);
  }
  if (filter?.offset) {
    sql += " OFFSET ?";
    params.push(filter.offset);
  }

  const rows = db.query(sql).all(...params) as PersonaRow[];
  return rows.map(personaFromRow);
}

export function getGlobalPersonas(): Persona[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT * FROM personas WHERE project_id IS NULL AND enabled = 1 ORDER BY created_at DESC")
    .all() as PersonaRow[];
  return rows.map(personaFromRow);
}

export function updatePersona(id: string, updates: UpdatePersonaInput, version: number): Persona {
  const db = getDatabase();
  const existing = getPersona(id);
  if (!existing) {
    throw new PersonaNotFoundError(id);
  }

  if (existing.version !== version) {
    throw new VersionConflictError("persona", existing.id);
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.role !== undefined) {
    sets.push("role = ?");
    params.push(updates.role);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    params.push(updates.description);
  }
  if (updates.instructions !== undefined) {
    sets.push("instructions = ?");
    params.push(updates.instructions);
  }
  if (updates.traits !== undefined) {
    sets.push("traits = ?");
    params.push(JSON.stringify(updates.traits));
  }
  if (updates.goals !== undefined) {
    sets.push("goals = ?");
    params.push(JSON.stringify(updates.goals));
  }
  if (updates.behaviors !== undefined) {
    sets.push("behaviors = ?");
    params.push(JSON.stringify(updates.behaviors));
  }
  if (updates.expertiseLevel !== undefined) {
    sets.push("expertise_level = ?");
    params.push(updates.expertiseLevel);
  }
  if (updates.demographics !== undefined) {
    sets.push("demographics = ?");
    params.push(JSON.stringify(updates.demographics));
  }
  if (updates.painPoints !== undefined) {
    sets.push("pain_points = ?");
    params.push(JSON.stringify(updates.painPoints));
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(updates.enabled ? 1 : 0);
  }
  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(updates.metadata));
  }
  if (updates.authEmail !== undefined) {
    sets.push("auth_email = ?");
    params.push(updates.authEmail);
  }
  if (updates.authPassword !== undefined) {
    sets.push("auth_password = ?");
    params.push(updates.authPassword);
  }
  if (updates.authLoginPath !== undefined) {
    sets.push("auth_login_path = ?");
    params.push(updates.authLoginPath);
  }
  if (updates.authCookies !== undefined) {
    sets.push("auth_cookies = ?");
    params.push(updates.authCookies ? JSON.stringify(updates.authCookies) : null);
  }

  if (sets.length === 0) {
    return existing;
  }

  sets.push("version = ?");
  params.push(version + 1);
  sets.push("updated_at = ?");
  params.push(now());

  params.push(existing.id);
  params.push(version);

  const result = db
    .query(`UPDATE personas SET ${sets.join(", ")} WHERE id = ? AND version = ?`)
    .run(...params);

  if (result.changes === 0) {
    throw new VersionConflictError("persona", existing.id);
  }

  return getPersona(existing.id)!;
}

export function deletePersona(id: string): boolean {
  const db = getDatabase();
  const persona = getPersona(id);
  if (!persona) return false;

  const result = db.query("DELETE FROM personas WHERE id = ?").run(persona.id);
  return result.changes > 0;
}

/**
 * List personas that have auth credentials configured (for multi-user session pool).
 */
export function listAuthenticatedPersonas(projectId?: string): Persona[] {
  const db = getDatabase();
  const conditions = ["auth_email IS NOT NULL", "auth_password IS NOT NULL", "enabled = 1"];
  const params: string[] = [];

  if (projectId) {
    conditions.push("(project_id = ? OR project_id IS NULL)");
    params.push(projectId);
  }

  const sql = `SELECT * FROM personas WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;
  const rows = db.query(sql).all(...params) as PersonaRow[];
  return rows.map(personaFromRow);
}

/**
 * Save authenticated session cookies back to a persona (after login).
 */
export function savePersonaAuthCookies(id: string, cookies: Record<string, unknown>[]): void {
  const db = getDatabase();
  db.query("UPDATE personas SET auth_cookies = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(cookies), now(), id);
}

export function countPersonas(filter?: PersonaFilter): number {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter?.globalOnly) {
    conditions.push("project_id IS NULL");
  } else if (filter?.projectId) {
    conditions.push("(project_id = ? OR project_id IS NULL)");
    params.push(filter.projectId);
  }

  if (filter?.enabled !== undefined) {
    conditions.push("enabled = ?");
    params.push(filter.enabled ? 1 : 0);
  }

  let sql = "SELECT COUNT(*) as count FROM personas";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  const row = db.query(sql).get(...params) as { count: number };
  return row.count;
}
