import type { Database } from "bun:sqlite";
import { getDb } from "./database.js";
import { type Search, type SearchProviderName, generateId } from "../types/index.js";

interface SearchRow {
  id: string;
  query: string;
  providers: string;
  profile_id: string | null;
  result_count: number;
  duration: number;
  created_at: string;
}

function rowToSearch(row: SearchRow): Search {
  return {
    id: row.id,
    query: row.query,
    providers: JSON.parse(row.providers) as SearchProviderName[],
    profileId: row.profile_id,
    resultCount: row.result_count,
    duration: row.duration,
    createdAt: row.created_at,
  };
}

export function createSearch(
  data: {
    query: string;
    providers: SearchProviderName[];
    profileId?: string | null;
    resultCount?: number;
    duration?: number;
  },
  db?: Database,
): Search {
  const d = db ?? getDb();
  const id = generateId();
  const now = new Date().toISOString();

  d.prepare(
    `INSERT INTO searches (id, query, providers, profile_id, result_count, duration, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.query,
    JSON.stringify(data.providers),
    data.profileId ?? null,
    data.resultCount ?? 0,
    data.duration ?? 0,
    now,
  );

  return {
    id,
    query: data.query,
    providers: data.providers,
    profileId: data.profileId ?? null,
    resultCount: data.resultCount ?? 0,
    duration: data.duration ?? 0,
    createdAt: now,
  };
}

export function getSearch(id: string, db?: Database): Search | null {
  const d = db ?? getDb();
  const row = d.prepare("SELECT * FROM searches WHERE id = ?").get(id) as SearchRow | null;
  return row ? rowToSearch(row) : null;
}

export function listSearches(
  opts: { query?: string; limit?: number; offset?: number } = {},
  db?: Database,
): { searches: Search[]; total: number } {
  const d = db ?? getDb();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  let where = "";
  if (opts.query) {
    where = "WHERE query LIKE ?";
  }

  const countParams = opts.query ? [`%${opts.query}%`] : [];
  const total = (
    d.prepare(`SELECT COUNT(*) as count FROM searches ${where}`).get(...countParams) as { count: number }
  ).count;

  const queryParams = opts.query
    ? [`%${opts.query}%`, limit, offset]
    : [limit, offset];
  const rows = d
    .prepare(`SELECT * FROM searches ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...queryParams) as SearchRow[];

  return { searches: rows.map(rowToSearch), total };
}

export function deleteSearch(id: string, db?: Database): boolean {
  const d = db ?? getDb();
  const result = d.prepare("DELETE FROM searches WHERE id = ?").run(id);
  return result.changes > 0;
}

export function updateSearchResults(
  id: string,
  resultCount: number,
  duration: number,
  db?: Database,
): void {
  const d = db ?? getDb();
  d.prepare("UPDATE searches SET result_count = ?, duration = ? WHERE id = ?").run(
    resultCount,
    duration,
    id,
  );
}

export function getSearchStats(db?: Database): {
  totalSearches: number;
  totalResults: number;
  providerBreakdown: Record<string, number>;
} {
  const d = db ?? getDb();

  const totalSearches = (
    d.prepare("SELECT COUNT(*) as count FROM searches").get() as { count: number }
  ).count;

  const totalResults = (
    d.prepare("SELECT COUNT(*) as count FROM search_results").get() as { count: number }
  ).count;

  const breakdown = d
    .prepare("SELECT source, COUNT(*) as count FROM search_results GROUP BY source")
    .all() as Array<{ source: string; count: number }>;

  const providerBreakdown: Record<string, number> = {};
  for (const row of breakdown) {
    providerBreakdown[row.source] = row.count;
  }

  return { totalSearches, totalResults, providerBreakdown };
}
