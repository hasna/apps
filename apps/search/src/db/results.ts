import type { Database } from "bun:sqlite";
import { getDb } from "./database.js";
import { type SearchResult, type SearchProviderName, generateId } from "../types/index.js";

interface ResultRow {
  id: string;
  search_id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  provider: string;
  rank: number;
  score: number | null;
  published_at: string | null;
  thumbnail: string | null;
  metadata: string;
  created_at: string;
}

function rowToResult(row: ResultRow): SearchResult {
  return {
    id: row.id,
    searchId: row.search_id,
    title: row.title,
    url: row.url,
    snippet: row.snippet,
    source: row.source as SearchProviderName,
    provider: row.provider,
    rank: row.rank,
    score: row.score,
    publishedAt: row.published_at,
    thumbnail: row.thumbnail,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

export function createResult(
  data: {
    searchId: string;
    title: string;
    url: string;
    snippet: string;
    source: SearchProviderName;
    provider: string;
    rank: number;
    score?: number | null;
    publishedAt?: string | null;
    thumbnail?: string | null;
    metadata?: Record<string, unknown>;
  },
  db?: Database,
): SearchResult {
  const d = db ?? getDb();
  const id = generateId();
  const now = new Date().toISOString();

  d.prepare(
    `INSERT INTO search_results (id, search_id, title, url, snippet, source, provider, rank, score, published_at, thumbnail, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.searchId,
    data.title,
    data.url,
    data.snippet,
    data.source,
    data.provider,
    data.rank,
    data.score ?? null,
    data.publishedAt ?? null,
    data.thumbnail ?? null,
    JSON.stringify(data.metadata ?? {}),
    now,
  );

  return {
    id,
    searchId: data.searchId,
    title: data.title,
    url: data.url,
    snippet: data.snippet,
    source: data.source,
    provider: data.provider,
    rank: data.rank,
    score: data.score ?? null,
    publishedAt: data.publishedAt ?? null,
    thumbnail: data.thumbnail ?? null,
    metadata: data.metadata ?? {},
    createdAt: now,
  };
}

export function createResults(
  results: Array<{
    searchId: string;
    title: string;
    url: string;
    snippet: string;
    source: SearchProviderName;
    provider: string;
    rank: number;
    score?: number | null;
    publishedAt?: string | null;
    thumbnail?: string | null;
    metadata?: Record<string, unknown>;
  }>,
  db?: Database,
): SearchResult[] {
  const d = db ?? getDb();
  const created: SearchResult[] = [];

  const stmt = d.prepare(
    `INSERT INTO search_results (id, search_id, title, url, snippet, source, provider, rank, score, published_at, thumbnail, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const now = new Date().toISOString();

  d.exec("BEGIN");
  try {
    for (const data of results) {
      const id = generateId();
      stmt.run(
        id,
        data.searchId,
        data.title,
        data.url,
        data.snippet,
        data.source,
        data.provider,
        data.rank,
        data.score ?? null,
        data.publishedAt ?? null,
        data.thumbnail ?? null,
        JSON.stringify(data.metadata ?? {}),
        now,
      );
      created.push({
        id,
        searchId: data.searchId,
        title: data.title,
        url: data.url,
        snippet: data.snippet,
        source: data.source,
        provider: data.provider,
        rank: data.rank,
        score: data.score ?? null,
        publishedAt: data.publishedAt ?? null,
        thumbnail: data.thumbnail ?? null,
        metadata: data.metadata ?? {},
        createdAt: now,
      });
    }
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }

  return created;
}

export function getResult(id: string, db?: Database): SearchResult | null {
  const d = db ?? getDb();
  const row = d.prepare("SELECT * FROM search_results WHERE id = ?").get(id) as ResultRow | null;
  return row ? rowToResult(row) : null;
}

export function listResults(
  searchId: string,
  opts: { limit?: number; offset?: number; source?: SearchProviderName } = {},
  db?: Database,
): SearchResult[] {
  const d = db ?? getDb();
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  if (opts.source) {
    const rows = d
      .prepare(
        "SELECT * FROM search_results WHERE search_id = ? AND source = ? ORDER BY rank ASC LIMIT ? OFFSET ?",
      )
      .all(searchId, opts.source, limit, offset) as ResultRow[];
    return rows.map(rowToResult);
  }

  const rows = d
    .prepare(
      "SELECT * FROM search_results WHERE search_id = ? ORDER BY rank ASC LIMIT ? OFFSET ?",
    )
    .all(searchId, limit, offset) as ResultRow[];
  return rows.map(rowToResult);
}

export function searchResultsFts(
  query: string,
  opts: { limit?: number } = {},
  db?: Database,
): SearchResult[] {
  const d = db ?? getDb();
  const limit = opts.limit ?? 50;

  const rows = d
    .prepare(
      `SELECT sr.* FROM search_results sr
       JOIN search_results_fts fts ON sr.rowid = fts.rowid
       WHERE search_results_fts MATCH ?
       ORDER BY fts.rank
       LIMIT ?`,
    )
    .all(query, limit) as ResultRow[];

  return rows.map(rowToResult);
}
