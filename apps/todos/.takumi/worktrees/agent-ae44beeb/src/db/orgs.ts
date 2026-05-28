import type { Database } from "bun:sqlite";
import type { Org, CreateOrgInput } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToOrg(row: any): Org {
  return { ...row, metadata: JSON.parse(row.metadata || "{}") };
}

export function createOrg(input: CreateOrgInput, db?: Database): Org {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO orgs (id, name, description, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.description || null, JSON.stringify(input.metadata || {}), timestamp, timestamp],
  );
  return getOrg(id, d)!;
}

export function getOrg(id: string, db?: Database): Org | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM orgs WHERE id = ?").get(id);
  return row ? rowToOrg(row) : null;
}

export function getOrgByName(name: string, db?: Database): Org | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM orgs WHERE name = ?").get(name);
  return row ? rowToOrg(row) : null;
}

export function listOrgs(db?: Database): Org[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM orgs ORDER BY name").all()).map(rowToOrg);
}

export function updateOrg(id: string, input: { name?: string; description?: string; metadata?: Record<string, unknown> }, db?: Database): Org {
  const d = db || getDatabase();
  const org = getOrg(id, d);
  if (!org) throw new Error(`Org not found: ${id}`);
  const sets: string[] = ["updated_at = ?"];
  const params: (string | null)[] = [now()];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }
  if (input.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }
  params.push(id);
  d.run(`UPDATE orgs SET ${sets.join(", ")} WHERE id = ?`, params);
  return getOrg(id, d)!;
}

export function deleteOrg(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM orgs WHERE id = ?", [id]).changes > 0;
}
