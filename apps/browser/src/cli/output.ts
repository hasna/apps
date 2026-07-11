import chalk from "chalk";

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 200;

export function parseLimit(value: string | undefined, fallback = DEFAULT_LIST_LIMIT): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_LIST_LIMIT);
}

export function truncate(value: unknown, max = 80): string {
  const text = value == null ? "" : String(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function shortId(value: string | undefined, length = 8): string {
  if (!value) return "";
  return value.length <= length ? value : value.slice(0, length);
}

export function formatBytes(value: number | undefined): string {
  if (!Number.isFinite(value)) return "-";
  const bytes = value as number;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export function limited<T>(items: T[], limit: number): { visible: T[]; hidden: number; total: number } {
  return {
    visible: items.slice(0, limit),
    hidden: Math.max(0, items.length - limit),
    total: items.length,
  };
}

export function printListFooter(total: number, shown: number, hint?: string): void {
  const hidden = Math.max(0, total - shown);
  const parts = [`${shown}/${total} shown`];
  if (hidden > 0) parts.push(`${hidden} more hidden`);
  console.log(chalk.gray(parts.join(", ")));
  if (hidden > 0 || hint) {
    console.log(chalk.gray(hint ?? "Use --limit, --verbose, --json, or a show/get command for details."));
  }
}

export function printPageFooter(shown: number, hasMore: boolean, hint?: string): void {
  console.log(chalk.gray(`${shown} shown${hasMore ? ", more available" : ""}`));
  if (hasMore || hint) {
    console.log(chalk.gray(hint ?? "Use --limit, --verbose, --json, or a show/get command for details."));
  }
}

export function printHint(message: string): void {
  console.log(chalk.gray(message));
}
