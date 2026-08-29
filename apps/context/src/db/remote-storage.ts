import pg from "pg";
import type { Pool, PoolConfig } from "pg";
import type { Library, SearchResult } from "../types/index.js";

const DISABLED_SSL_MODE = "disable";

/**
 * Characters that are tsquery syntax and must not reach to_tsquery unescaped.
 * The local FTS5 path escapes quotes (chunks.ts escapeFts); the hosted path
 * strips tsquery operators instead, keeping letter/number/. /-/_ terms.
 */
const TSQL_SYNTAX = /[&|!():*'"\\]+/g;

/**
 * Build a PostgreSQL tsquery from a plain-text query, mirroring the local
 * FTS5 escapeFts semantics (db/chunks.ts): each whitespace token becomes a
 * prefix term and terms are ANDed. Returns null when no term survives.
 */
export function buildPrefixTsQuery(query: string): string | null {
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(TSQL_SYNTAX, ""))
    .filter(Boolean);
  if (terms.length === 0) return null;
  return terms.map((term) => `${term}:*`).join(" & ");
}

interface PgChunkSearchRow {
  chunk_id: string;
  library_id: string;
  document_id: string;
  content: string;
  url: string | null;
  title: string | null;
  score: number;
}

function rowToLibrary(row: Record<string, unknown>): Library {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    slug: row["slug"] as string,
    description: (row["description"] as string) ?? null,
    npm_package: (row["npm_package"] as string) ?? null,
    github_repo: (row["github_repo"] as string) ?? null,
    docs_url: (row["docs_url"] as string) ?? null,
    version: (row["version"] as string) ?? null,
    source_type: ((row["source_type"] as string) ?? "docs") as Library["source_type"],
    source_url: (row["source_url"] as string) ?? null,
    freshness_days: (row["freshness_days"] as number) ?? 7,
    priority: (row["priority"] as number) ?? 0,
    chunk_count: (row["chunk_count"] as number) ?? 0,
    document_count: (row["document_count"] as number) ?? 0,
    last_crawled_at: (row["last_crawled_at"] as string) ?? null,
    last_checked_at: (row["last_checked_at"] as string) ?? null,
    next_check_at: (row["next_check_at"] as string) ?? null,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  };
}

function translatePlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => value === undefined ? null : value);
}

function normalizeHost(hostname: string): string {
  const stripped = hostname.replace(/^\[/, "").replace(/\]$/, "");
  try {
    return decodeURIComponent(stripped).toLowerCase();
  } catch {
    return stripped.toLowerCase();
  }
}

export function isLocalPostgresHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "" || host.startsWith("/");
}

function effectivePgHost(url: URL): string {
  const hosts = url.searchParams.getAll("host");
  const finalHost = hosts.length > 0 ? hosts[hosts.length - 1] : null;
  if (finalHost?.trim()) return finalHost;
  if (url.hostname.trim()) return url.hostname;
  return process.env.PGHOST?.trim() || url.hostname;
}

export function buildPgPoolConfig(connectionString: string): PoolConfig {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Invalid PostgreSQL connection string");
  }

  const sslMode = url.searchParams.get("sslmode")?.trim().toLowerCase();
  const sslValue = url.searchParams.get("ssl")?.trim().toLowerCase();
  const isLocal = isLocalPostgresHost(effectivePgHost(url));
  const hasDisabledSsl = sslMode === DISABLED_SSL_MODE || sslValue === "false";

  if (!isLocal && hasDisabledSsl) {
    throw new Error("Refusing remote PostgreSQL connection with TLS disabled");
  }

  const shouldUseSsl = !isLocal || sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full" || sslValue === "true";
  url.searchParams.delete("sslmode");
  url.searchParams.delete("ssl");

  return {
    connectionString: url.toString(),
    ssl: shouldUseSsl ? { rejectUnauthorized: true } : undefined,
  };
}

export class PgAdapterAsync {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool(buildPgPoolConfig(connectionString));
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return { changes: result.rowCount ?? 0 };
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return result.rows;
  }

  /**
   * Full-text search over chunks on the hosted backend, equivalent to the
   * local SQLite FTS5 searchChunks (db/chunks.ts): prefix terms ANDed, ranked,
   * joined with documents for url/title. Score is ts_rank — higher is better,
   * the inverse of the local FTS5 rank.
   */
  async searchChunks(query: string, libraryId?: string, limit = 10): Promise<SearchResult[]> {
    const tsquery = buildPrefixTsQuery(query);
    if (!tsquery) return [];
    try {
      const rows = (await this.all(
        `SELECT
           c.id AS chunk_id,
           c.library_id,
           c.document_id,
           c.content,
           d.url,
           d.title,
           ts_rank(c.content_tsv, to_tsquery('english', $1)) AS score
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE c.content_tsv @@ to_tsquery('english', $1)
           AND ($2::text IS NULL OR c.library_id = $2)
         ORDER BY score DESC
         LIMIT $3`,
        tsquery,
        libraryId ?? null,
        limit,
      )) as unknown as PgChunkSearchRow[];
      return rows.map((r) => ({
        chunk_id: r.chunk_id,
        library_id: r.library_id,
        document_id: r.document_id,
        content: r.content,
        url: r.url,
        title: r.title,
        score: r.score,
      }));
    } catch (error) {
      // Propagate: a hosted-backend failure must never masquerade as an
      // empty result set (HTTP 200 with no matches while data exists).
      throw error;
    }
  }

  /**
   * Full-text search over libraries on the hosted backend, equivalent to the
   * local searchLibraries (db/libraries.ts), including its ILIKE substring
   * fallback when the FTS predicate misses.
   */
  async searchLibraries(query: string, limit = 10): Promise<Library[]> {
    const tsquery = buildPrefixTsQuery(query);
    if (!tsquery) return [];
    let rows: unknown[];
    try {
      rows = await this.all(
        `SELECT l.*
         FROM libraries l
         WHERE l.search_tsv @@ to_tsquery('english', $1)
         ORDER BY ts_rank(l.search_tsv, to_tsquery('english', $1)) DESC
         LIMIT $2`,
        tsquery,
        limit,
      );
    } catch (error) {
      // Propagate: a hosted-backend failure must never masquerade as an
      // empty result set (HTTP 200 with no matches while data exists).
      throw error;
    }
    if (rows.length > 0) {
      return (rows as Record<string, unknown>[]).map(rowToLibrary);
    }

    // FTS fallback parity with the local fallbackSearchLibraries: every query
    // term must appear as a substring in the library's searchable fields.
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    try {
      const like = terms.map((term) => `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      const perTerm = like
        .map((_, i) => {
          const p = i + 1;
          return `(name ILIKE $${p} OR slug ILIKE $${p} OR description ILIKE $${p}
            OR npm_package ILIKE $${p} OR github_repo ILIKE $${p}
            OR version ILIKE $${p} OR source_type ILIKE $${p})`;
        })
        .join(" AND ");
      const fallbackRows = (await this.all(
        `SELECT * FROM libraries
         WHERE ${perTerm}
         ORDER BY name ASC
         LIMIT $${like.length + 1}`,
        ...like,
        limit,
      )) as Record<string, unknown>[];
      return fallbackRows.map(rowToLibrary);
    } catch (error) {
      // Propagate: a hosted-backend failure must never masquerade as an
      // empty result set (HTTP 200 with no matches while data exists).
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
