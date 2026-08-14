import { writeFileSync } from "fs";
import type { ExportFormat, Page } from "../types/index.js";
import { getPage } from "../db/pages.js";
import { listPages } from "../db/pages.js";

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatJson(pages: Page[]): string {
  return JSON.stringify(pages, null, 2);
}

function formatMarkdown(pages: Page[]): string {
  const sections: string[] = [];

  for (const page of pages) {
    const lines: string[] = [];
    lines.push(`# ${page.title ?? page.url}`);
    lines.push("");
    lines.push(`**URL:** ${page.url}`);
    if (page.description) {
      lines.push(`**Description:** ${page.description}`);
    }
    if (page.wordCount !== null) {
      lines.push(`**Word Count:** ${page.wordCount}`);
    }
    lines.push(`**Crawled At:** ${page.crawledAt}`);
    if (page.statusCode !== null) {
      lines.push(`**Status Code:** ${page.statusCode}`);
    }

    const meta = page.metadata;
    if (meta.lang) {
      lines.push(`**Language:** ${meta.lang}`);
    }
    if (meta.canonicalUrl) {
      lines.push(`**Canonical URL:** ${meta.canonicalUrl}`);
    }

    if (page.markdownContent) {
      lines.push("");
      lines.push(page.markdownContent);
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n---\n\n");
}

function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatCsv(pages: Page[]): string {
  const headers = [
    "id",
    "url",
    "title",
    "description",
    "word_count",
    "crawled_at",
    "status_code",
  ];

  const rows = pages.map((page) =>
    [
      page.id,
      page.url,
      page.title,
      page.description,
      page.wordCount,
      page.crawledAt,
      page.statusCode,
    ]
      .map(escapeCsvField)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

// ─── Page loading helpers ─────────────────────────────────────────────────────

function loadAllPages(crawlId: string): Page[] {
  const pages: Page[] = [];
  const batchSize = 500;
  let offset = 0;

  while (true) {
    const batch = listPages(crawlId, { limit: batchSize, offset });
    pages.push(...batch);
    if (batch.length < batchSize) break;
    offset += batchSize;
  }

  return pages;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export async function exportCrawl(
  crawlId: string,
  format: ExportFormat,
  outputPath?: string
): Promise<string> {
  const pages = loadAllPages(crawlId);

  let content: string;
  switch (format) {
    case "json":
      content = formatJson(pages);
      break;
    case "md":
      content = formatMarkdown(pages);
      break;
    case "csv":
      content = formatCsv(pages);
      break;
    default:
      throw new Error(`Unknown export format: ${format as string}`);
  }

  if (outputPath) {
    writeFileSync(outputPath, content, "utf-8");
  }

  return content;
}

export async function exportPage(
  pageId: string,
  format: ExportFormat
): Promise<string> {
  const page = getPage(pageId);
  if (!page) throw new Error(`Page not found: ${pageId}`);

  switch (format) {
    case "json":
      return formatJson([page]);
    case "md":
      return formatMarkdown([page]);
    case "csv":
      return formatCsv([page]);
    default:
      throw new Error(`Unknown export format: ${format as string}`);
  }
}
