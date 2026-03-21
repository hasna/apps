import type { Database } from "bun:sqlite";
import { getDb } from "./database.js";
import {
  type SavedSearch,
  type SearchProviderName,
  type SearchOptions,
  generateId,
} from "../types/index.js";

interface SavedSearchRow {
  id: string;
  name: string;
  query: string;
  providers: string;
  profile_id: string | null;
  options: string;
  created_at: string;
  last_run_at: string | null;
}

function rowToSavedSearch(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    providers: JSON.parse(row.providers) as SearchProviderName[],
    profileId: row.profile_id,
    options: JSON.parse(row.options) as SearchOptions,
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
  };
}

export function createSavedSearch(
  data: {
    name: string;
    query: string;
    providers: SearchProviderName[];
    profileId?: string | null;
    options?: SearchOptions;
  },
  db?: Database,
): SavedSearch {
  const d = db ?? getDb();
  const id = generateId();
  const now = new Date().toISOString();

  d.prepare(
    `INSERT INTO saved_searches (id, name, query, providers, profile_id, options, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.name,
    data.query,
    JSON.stringify(data.providers),
    data.profileId ?? null,
    JSON.stringify(data.options ?? {}),
    now,
  );

  return {
    id,
    name: data.name,
    query: data.query,
    providers: data.providers,
    profileId: data.profileId ?? null,
    options: data.options ?? {},
    createdAt: now,
    lastRunAt: null,
  };
}

export function getSavedSearch(id: string, db?: Database): SavedSearch | null {
  const d = db ?? getDb();
  const row = d
    .prepare("SELECT * FROM saved_searches WHERE id = ?")
    .get(id) as SavedSearchRow | null;
  return row ? rowToSavedSearch(row) : null;
}

export function listSavedSearches(db?: Database): SavedSearch[] {
  const d = db ?? getDb();
  const rows = d
    .prepare("SELECT * FROM saved_searches ORDER BY created_at DESC")
    .all() as SavedSearchRow[];
  return rows.map(rowToSavedSearch);
}

export function deleteSavedSearch(id: string, db?: Database): boolean {
  const d = db ?? getDb();
  const result = d.prepare("DELETE FROM saved_searches WHERE id = ?").run(id);
  return result.changes > 0;
}

export function updateSavedSearchLastRun(id: string, db?: Database): void {
  const d = db ?? getDb();
  const now = new Date().toISOString();
  d.prepare("UPDATE saved_searches SET last_run_at = ? WHERE id = ?").run(now, id);
}
