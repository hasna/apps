import type { Database } from "bun:sqlite";
import { getDb } from "./database.js";
import {
  type SearchProfile,
  type SearchProviderName,
  type SearchOptions,
  generateId,
} from "../types/index.js";

interface ProfileRow {
  id: string;
  name: string;
  description: string | null;
  providers: string;
  options: string;
  created_at: string;
}

function rowToProfile(row: ProfileRow): SearchProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    providers: JSON.parse(row.providers) as SearchProviderName[],
    options: JSON.parse(row.options) as SearchOptions,
    createdAt: row.created_at,
  };
}

export function getProfile(id: string, db?: Database): SearchProfile | null {
  const d = db ?? getDb();
  const row = d
    .prepare("SELECT * FROM search_profiles WHERE id = ?")
    .get(id) as ProfileRow | null;
  return row ? rowToProfile(row) : null;
}

export function getProfileByName(name: string, db?: Database): SearchProfile | null {
  const d = db ?? getDb();
  const row = d
    .prepare("SELECT * FROM search_profiles WHERE name = ?")
    .get(name) as ProfileRow | null;
  return row ? rowToProfile(row) : null;
}

export function listProfiles(db?: Database): SearchProfile[] {
  const d = db ?? getDb();
  const rows = d
    .prepare("SELECT * FROM search_profiles ORDER BY name")
    .all() as ProfileRow[];
  return rows.map(rowToProfile);
}

export function createProfile(
  data: {
    name: string;
    description?: string | null;
    providers: SearchProviderName[];
    options?: SearchOptions;
  },
  db?: Database,
): SearchProfile {
  const d = db ?? getDb();
  const id = generateId();
  const now = new Date().toISOString();

  d.prepare(
    `INSERT INTO search_profiles (id, name, description, providers, options, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.name,
    data.description ?? null,
    JSON.stringify(data.providers),
    JSON.stringify(data.options ?? {}),
    now,
  );

  return {
    id,
    name: data.name,
    description: data.description ?? null,
    providers: data.providers,
    options: data.options ?? {},
    createdAt: now,
  };
}

export function deleteProfile(id: string, db?: Database): boolean {
  const d = db ?? getDb();
  const result = d.prepare("DELETE FROM search_profiles WHERE id = ?").run(id);
  return result.changes > 0;
}
