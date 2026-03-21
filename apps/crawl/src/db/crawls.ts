import type { Crawl, CreateCrawlInput } from "../types/index";
import { getDb } from "./database";

interface CrawlRow {
  id: string;
  url: string;
  domain: string | null;
  status: string;
  depth: number;
  max_pages: number;
  pages_crawled: number;
  options: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error_message: string | null;
}


function rowToCrawl(row: CrawlRow): Crawl {
  return {
    id: row.id,
    url: row.url,
    domain: row.domain,
    status: row.status as Crawl["status"],
    depth: row.depth,
    maxPages: row.max_pages,
    pagesCrawled: row.pages_crawled,
    options: JSON.parse(row.options),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

export function createCrawl(input: CreateCrawlInput): Crawl {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  let domain: string | null = null;
  try {
    domain = new URL(input.url).hostname;
  } catch {
    // leave null if URL is invalid
  }

  const depth = input.depth ?? 1;
  const maxPages = input.maxPages ?? 100;
  const options = JSON.stringify(input.options ?? {});

  const stmt = db.prepare(`
    INSERT INTO crawls (id, url, domain, status, depth, max_pages, pages_crawled, options, created_at, updated_at, completed_at, error_message)
    VALUES (?, ?, ?, 'pending', ?, ?, 0, ?, ?, ?, NULL, NULL)
  `);

  stmt.run(id, input.url, domain, depth, maxPages, options, now, now);

  return getCrawl(id)!;
}

export function getCrawl(id: string): Crawl | null {
  const db = getDb();
  const stmt = db.prepare<CrawlRow, [string]>("SELECT * FROM crawls WHERE id = ?");
  const row = stmt.get(id);
  return row ? rowToCrawl(row) : null;
}

export function listCrawls(options?: {
  status?: string;
  domain?: string;
  limit?: number;
  offset?: number;
}): Crawl[] {
  const db = getDb();
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options?.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options?.domain) {
    conditions.push("url LIKE ?");
    params.push(`%${options.domain}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const stmt = db.prepare<CrawlRow, (string | number)[]>(
    `SELECT * FROM crawls ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  );
  return stmt.all(...params, limit, offset).map(rowToCrawl);
}

export function updateCrawl(
  id: string,
  updates: Partial<
    Pick<Crawl, "status" | "pagesCrawled" | "completedAt" | "errorMessage" | "updatedAt">
  >
): Crawl | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    setClauses.push("status = ?");
    values.push(updates.status);
  }
  if (updates.pagesCrawled !== undefined) {
    setClauses.push("pages_crawled = ?");
    values.push(updates.pagesCrawled);
  }
  if (updates.completedAt !== undefined) {
    setClauses.push("completed_at = ?");
    values.push(updates.completedAt);
  }
  if (updates.errorMessage !== undefined) {
    setClauses.push("error_message = ?");
    values.push(updates.errorMessage);
  }

  const updatedAt = updates.updatedAt ?? new Date().toISOString();
  setClauses.push("updated_at = ?");
  values.push(updatedAt);

  if (setClauses.length === 0) return getCrawl(id);

  values.push(id);
  const stmt = db.prepare(
    `UPDATE crawls SET ${setClauses.join(", ")} WHERE id = ?`
  );
  stmt.run(...(values as Parameters<typeof stmt.run>));

  return getCrawl(id);
}

export function deleteCrawl(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM crawls WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

export function getGlobalStats(): {
  totalCrawls: number;
  totalPages: number;
  totalWords: number;
  topDomains: Array<{ domain: string; pages: number }>;
  dbSizeBytes: number;
  avgPagesPerCrawl: number;
} {
  const db = getDb();

  const totalCrawlsRow = db.prepare<{ count: number }, []>("SELECT COUNT(*) as count FROM crawls").get();
  const totalCrawls = totalCrawlsRow?.count ?? 0;

  const totalPagesRow = db.prepare<{ count: number }, []>("SELECT COUNT(*) as count FROM pages").get();
  const totalPages = totalPagesRow?.count ?? 0;

  const totalWordsRow = db.prepare<{ total: number | null }, []>("SELECT SUM(word_count) as total FROM pages").get();
  const totalWords = totalWordsRow?.total ?? 0;

  const topDomainsRows = db
    .prepare<{ domain: string; pages: number }, []>(
      "SELECT domain, COUNT(*) as pages FROM crawls WHERE domain IS NOT NULL GROUP BY domain ORDER BY pages DESC LIMIT 10"
    )
    .all();
  const topDomains = topDomainsRows.map((row) => ({ domain: row.domain, pages: row.pages }));

  const avgPagesPerCrawl = totalCrawls > 0 ? totalPages / totalCrawls : 0;

  const dbPath = process.env.CRAWL_DB_PATH ?? `${process.env.HOME}/.open-crawl/data.db`;
  const dbSizeBytes = Bun.file(dbPath).size;

  return { totalCrawls, totalPages, totalWords, topDomains, dbSizeBytes, avgPagesPerCrawl };
}

export function getCrawlStats(
  id: string
): { total: number; statusCodes: Record<string, number>; avgWordCount: number } {
  const db = getDb();

  const totalStmt = db.prepare<{ total: number }, [string]>(
    "SELECT COUNT(*) as total FROM pages WHERE crawl_id = ?"
  );
  const totalRow = totalStmt.get(id);
  const total = totalRow?.total ?? 0;

  const statusStmt = db.prepare<{ status_code: number | null; count: number }, [string]>(
    "SELECT status_code, COUNT(*) as count FROM pages WHERE crawl_id = ? GROUP BY status_code"
  );
  const statusRows = statusStmt.all(id);
  const statusCodes: Record<string, number> = {};
  for (const row of statusRows) {
    statusCodes[String(row.status_code ?? "null")] = row.count;
  }

  const avgStmt = db.prepare<{ avg_word_count: number | null }, [string]>(
    "SELECT AVG(word_count) as avg_word_count FROM pages WHERE crawl_id = ? AND word_count IS NOT NULL"
  );
  const avgRow = avgStmt.get(id);
  const avgWordCount = avgRow?.avg_word_count ?? 0;

  return { total, statusCodes, avgWordCount };
}
