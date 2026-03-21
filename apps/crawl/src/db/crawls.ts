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
  limit?: number;
  offset?: number;
}): Crawl[] {
  const db = getDb();
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  if (options?.status) {
    const stmt = db.prepare<CrawlRow, [string, number, number]>(
      "SELECT * FROM crawls WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    );
    return stmt.all(options.status, limit, offset).map(rowToCrawl);
  }

  const stmt = db.prepare<CrawlRow, [number, number]>(
    "SELECT * FROM crawls ORDER BY created_at DESC LIMIT ? OFFSET ?"
  );
  return stmt.all(limit, offset).map(rowToCrawl);
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
