import type { Page, CreatePageInput, SearchResult, SearchOptions, PageVersion } from "../types/index";
import { getDb } from "./database";

interface PageRow {
  id: string;
  crawl_id: string;
  url: string;
  status_code: number | null;
  content_type: string | null;
  title: string | null;
  description: string | null;
  text_content: string | null;
  markdown_content: string | null;
  html_content: string | null;
  metadata: string;
  screenshot_path: string | null;
  word_count: number | null;
  byte_size: number | null;
  crawled_at: string;
}

interface PageVersionRow {
  id: string;
  page_id: string;
  text_content: string | null;
  crawled_at: string;
  diff_summary: string | null;
}

interface FtsRow extends PageRow {
  snippet: string;
  rank: number;
}

function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    crawlId: row.crawl_id,
    url: row.url,
    statusCode: row.status_code,
    contentType: row.content_type,
    title: row.title,
    description: row.description,
    textContent: row.text_content,
    markdownContent: row.markdown_content,
    htmlContent: row.html_content,
    metadata: JSON.parse(row.metadata),
    screenshotPath: row.screenshot_path,
    wordCount: row.word_count,
    byteSize: row.byte_size,
    crawledAt: row.crawled_at,
  };
}

function rowToPageVersion(row: PageVersionRow): PageVersion {
  return {
    id: row.id,
    pageId: row.page_id,
    textContent: row.text_content,
    crawledAt: row.crawled_at,
    diffSummary: row.diff_summary,
  };
}

export function createPage(input: CreatePageInput): Page {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata = JSON.stringify(input.metadata ?? {});

  const stmt = db.prepare(`
    INSERT INTO pages (
      id, crawl_id, url, status_code, content_type, title, description,
      text_content, markdown_content, html_content, metadata,
      screenshot_path, word_count, byte_size, crawled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.crawlId,
    input.url,
    input.statusCode ?? null,
    input.contentType ?? null,
    input.title ?? null,
    input.description ?? null,
    input.textContent ?? null,
    input.markdownContent ?? null,
    input.htmlContent ?? null,
    metadata,
    input.screenshotPath ?? null,
    input.wordCount ?? null,
    input.byteSize ?? null,
    now
  );

  return getPage(id)!;
}

export function getPage(id: string): Page | null {
  const db = getDb();
  const stmt = db.prepare<PageRow, [string]>("SELECT * FROM pages WHERE id = ?");
  const row = stmt.get(id);
  return row ? rowToPage(row) : null;
}

export function getPageByUrl(crawlId: string, url: string): Page | null {
  const db = getDb();
  const stmt = db.prepare<PageRow, [string, string]>(
    "SELECT * FROM pages WHERE crawl_id = ? AND url = ? LIMIT 1"
  );
  const row = stmt.get(crawlId, url);
  return row ? rowToPage(row) : null;
}

export function listPages(
  crawlId: string,
  options?: { limit?: number; offset?: number }
): Page[] {
  const db = getDb();
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;

  const stmt = db.prepare<PageRow, [string, number, number]>(
    "SELECT * FROM pages WHERE crawl_id = ? ORDER BY crawled_at DESC LIMIT ? OFFSET ?"
  );
  return stmt.all(crawlId, limit, offset).map(rowToPage);
}

export function deletePage(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM pages WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

export function searchPages(query: string, options?: SearchOptions): SearchResult[] {
  const db = getDb();
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  // Build JOIN conditions for domain/crawlId filtering
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options?.crawlId) {
    conditions.push("p.crawl_id = ?");
    params.push(options.crawlId);
  }

  if (options?.domain) {
    conditions.push("p.url LIKE ?");
    params.push(`%${options.domain}%`);
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  const sql = `
    SELECT
      p.*,
      snippet(pages_fts, -1, '<b>', '</b>', '...', 32) AS snippet,
      pages_fts.rank AS rank
    FROM pages_fts
    JOIN pages p ON pages_fts.rowid = p.rowid
    WHERE pages_fts MATCH ?
    ${whereClause}
    ORDER BY pages_fts.rank
    LIMIT ? OFFSET ?
  `;

  const stmt = db.prepare<FtsRow, (string | number)[]>(sql);
  const rows = stmt.all(query, ...params, limit, offset);

  return rows.map((row) => ({
    page: rowToPage(row),
    snippet: row.snippet,
    rank: row.rank,
  }));
}

export function savePageVersion(
  pageId: string,
  textContent: string | null,
  diffSummary?: string
): void {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO page_versions (id, page_id, text_content, crawled_at, diff_summary)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(id, pageId, textContent ?? null, now, diffSummary ?? null);
}

export function getPageVersions(pageId: string): PageVersion[] {
  const db = getDb();
  const stmt = db.prepare<PageVersionRow, [string]>(
    "SELECT * FROM page_versions WHERE page_id = ? ORDER BY crawled_at DESC"
  );
  return stmt.all(pageId).map(rowToPageVersion);
}
