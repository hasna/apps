import type { SearchResult, ExportFormat } from "../types/index.js";
import { listResults } from "../db/results.js";
import { getSearch } from "../db/searches.js";
import type { Database } from "bun:sqlite";

export function exportResults(
  searchId: string,
  format: ExportFormat,
  db?: Database,
): string {
  const search = getSearch(searchId, db);
  if (!search) throw new Error(`Search not found: ${searchId}`);

  const results = listResults(searchId, { limit: 1000 }, db);

  switch (format) {
    case "json":
      return exportJson(results);
    case "csv":
      return exportCsv(results);
    case "md":
      return exportMarkdown(results, search.query);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

function exportJson(results: SearchResult[]): string {
  return JSON.stringify(results, null, 2);
}

function exportCsv(results: SearchResult[]): string {
  const headers = ["rank", "title", "url", "snippet", "source", "provider", "score", "published_at"];
  const lines = [headers.join(",")];

  for (const r of results) {
    const row = [
      r.rank,
      csvEscape(r.title),
      csvEscape(r.url),
      csvEscape(r.snippet),
      r.source,
      r.provider,
      r.score ?? "",
      r.publishedAt ?? "",
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

function exportMarkdown(results: SearchResult[], query: string): string {
  const lines: string[] = [];
  lines.push(`# Search Results: ${query}`);
  lines.push("");
  lines.push(`*${results.length} results*`);
  lines.push("");

  for (const r of results) {
    lines.push(`## ${r.rank}. ${r.title}`);
    lines.push("");
    lines.push(`**Source:** ${r.provider} | **URL:** ${r.url}`);
    if (r.publishedAt) lines.push(`**Published:** ${r.publishedAt}`);
    if (r.score !== null) lines.push(`**Score:** ${r.score.toFixed(3)}`);
    lines.push("");
    if (r.snippet) {
      lines.push(`> ${r.snippet}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
