import chalk from "chalk";
import { getStyle } from "./registry.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

export function jsonOut(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function compactJson(data: unknown): string {
  return JSON.stringify(data);
}

export function prettyJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function truncateText(value: unknown, maxLength = 80): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

export function parsePositiveInt(value: string | number | undefined, fallback: number, max = 100): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export function parseCursor(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export interface PageOptions {
  limit?: string | number;
  cursor?: string | number;
  defaultLimit?: number;
  maxLimit?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  cursor: number;
  nextCursor: number | null;
  hasMore: boolean;
}

export function pageItems<T>(items: T[], options: PageOptions = {}): Page<T> {
  const limit = parsePositiveInt(options.limit, options.defaultLimit ?? 20, options.maxLimit ?? 100);
  const cursor = parseCursor(options.cursor);
  const page = items.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < items.length ? cursor + page.length : null;
  return {
    items: page,
    total: items.length,
    limit,
    cursor,
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

export interface TableColumn<T> {
  header: string;
  value: (item: T) => unknown;
  maxWidth?: number;
}

export function formatTable<T>(items: T[], columns: Array<TableColumn<T>>): string {
  if (items.length === 0) return "";

  const rows = items.map((item) =>
    columns.map((column) => truncateText(column.value(item), column.maxWidth ?? 40))
  );
  const widths = columns.map((column, index) => {
    const values = rows.map((row) => row[index].length);
    return Math.max(column.header.length, ...values);
  });

  const header = columns.map((column, index) => column.header.padEnd(widths[index])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows.map((row) => row.map((value, index) => value.padEnd(widths[index])).join("  "));

  return [header, divider, ...body].join("\n");
}

export function pageHint(page: Page<unknown>, detailHint?: string): string {
  const parts = [`showing ${page.items.length}/${page.total}`];
  if (page.hasMore) parts.push(`next: --cursor ${page.nextCursor}`);
  if (detailHint) parts.push(detailHint);
  parts.push("use --json for full machine-readable output");
  return parts.join("; ");
}

export function severityColor(sev: string): string {
  switch (sev) {
    case "critical": return chalk.red(sev);
    case "warning":  return chalk.yellow(sev);
    case "info":     return chalk.blue(sev);
    default:         return sev;
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "pass": return chalk.green(status);
    case "warn": return chalk.yellow(status);
    case "fail": return chalk.red(status);
    default:     return status;
  }
}

export function error(msg: string, suggestions?: string[]): never {
  if (isTTY) {
    console.error(chalk.red("✖ " + msg));
    if (suggestions?.length) {
      console.error(chalk.dim("  Suggestions: " + suggestions.join(", ")));
    }
  } else {
    jsonOut({ error: msg, suggestions: suggestions ?? [] });
  }
  process.exit(1);
}

export function formatAgo(ts: number | null | undefined): string | null {
  if (ts == null) return null;
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function buildStyleMdContent(styleName: string): string {
  const meta = getStyle(styleName);
  if (!meta) return `# Style: ${styleName}\n`;

  const lines = [
    `# Style: ${meta.displayName}`,
    ``,
    `**Category:** ${meta.category}`,
    ``,
    `## Description`,
    ``,
    meta.description,
    ``,
    `## Principles`,
    ``,
    ...meta.principles.map((p) => `- ${p}`),
    ``,
    `## Tags`,
    ``,
    meta.tags.join(", "),
    ``,
    `---`,
    `*Generated by open-styles*`,
  ];
  return lines.join("\n");
}
