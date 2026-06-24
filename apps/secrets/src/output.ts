import type { AuditEntry, SecretMetadata } from "./types.js";
import type { User } from "./store.js";

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  cursor: number;
  nextCursor: number | null;
  truncated: boolean;
}

export interface PageOptions {
  limit?: string | number;
  cursor?: string | number;
  defaultLimit?: number;
  maxLimit?: number;
}

type OutputMode = "cli" | "mcp";

export function parsePageOptions(options: PageOptions = {}): { limit: number; cursor: number } {
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = options.maxLimit ?? MAX_PAGE_LIMIT;
  const limit = parseBoundedInteger(options.limit, "limit", defaultLimit, { min: 1, max: maxLimit });
  const cursor = parseBoundedInteger(options.cursor, "cursor", 0, { min: 0 });
  return { limit, cursor };
}

export function pageItems<T>(items: T[], options: PageOptions = {}): Page<T> {
  const { limit, cursor } = parsePageOptions(options);
  return createPage(items.slice(cursor, cursor + limit), items.length, limit, cursor);
}

export function createPage<T>(items: T[], total: number, limit: number, cursor: number): Page<T> {
  const nextCursor = cursor + items.length < total ? cursor + items.length : null;
  return {
    items,
    total,
    limit,
    cursor,
    nextCursor,
    truncated: nextCursor !== null || cursor > 0,
  };
}

export function pageToJson<T>(page: Page<T>): {
  items: T[];
  total: number;
  limit: number;
  cursor: number;
  nextCursor: number | null;
  truncated: boolean;
} {
  return {
    items: page.items,
    total: page.total,
    limit: page.limit,
    cursor: page.cursor,
    nextCursor: page.nextCursor,
    truncated: page.truncated,
  };
}

export function formatSecretRows(
  page: Page<SecretMetadata>,
  options: { command: string; detailCommand?: string; verbose?: boolean; noun?: string; mode?: OutputMode }
): string {
  const verbose = options.verbose ?? false;
  const columns = verbose
    ? [
        { name: "TYPE", width: 10, value: (e: SecretMetadata) => e.type },
        { name: "EXPIRES", width: 10, value: (e: SecretMetadata) => formatDate(e.expires_at) },
        { name: "UPDATED", width: 10, value: (e: SecretMetadata) => formatDate(e.updated_at) },
        { name: "LABEL", width: 32, value: (e: SecretMetadata) => e.label ?? "-" },
        { name: "KEY", width: 3, value: (e: SecretMetadata) => e.key, truncate: false },
      ]
    : [
        { name: "TYPE", width: 10, value: (e: SecretMetadata) => e.type },
        { name: "EXPIRES", width: 10, value: (e: SecretMetadata) => formatDate(e.expires_at) },
        { name: "LABEL", width: 24, value: (e: SecretMetadata) => e.label ?? "-" },
        { name: "KEY", width: 3, value: (e: SecretMetadata) => e.key, truncate: false },
      ];

  const lines = page.items.length > 0 ? formatTable(columns, page.items) : [];
  if (lines.length > 0) lines.push("");
  lines.push(formatPageSummary(page, options.noun ?? "secret"));
  if (page.nextCursor !== null) {
    lines.push(formatNextHint(options.mode ?? "cli", options.command, page));
  }
  lines.push(formatSecretDetailHint(options.mode ?? "cli", options.detailCommand ?? "secrets show"));
  return lines.join("\n");
}

export function formatSecretDetail(entry: SecretMetadata, options: { mode?: OutputMode } = {}): string {
  const lines = [
    `key: ${entry.key}`,
    `type: ${entry.type}`,
    `label: ${entry.label ?? "-"}`,
    `created: ${entry.created_at}`,
    `updated: ${entry.updated_at}`,
    `expires: ${entry.expires_at ?? "-"}`,
    "value: not included",
  ];
  if ((options.mode ?? "cli") === "mcp") {
    lines.push(`To retrieve the value, call get_secret with ${JSON.stringify({ key: entry.key })} only when needed.`);
  } else {
    lines.push(`Use: secrets get ${shellArg(entry.key)} to print the value.`);
  }
  return lines.join("\n");
}

export function formatAuditRows(
  page: Page<AuditEntry>,
  options: { command: string; verbose?: boolean; noun?: string; mode?: OutputMode }
): string {
  const verbose = options.verbose ?? false;
  const columns = verbose
    ? [
        { name: "TIME", width: 20, value: (e: AuditEntry) => e.timestamp },
        { name: "ACTION", width: 6, value: (e: AuditEntry) => e.action.toUpperCase() },
        { name: "AGENT", width: 24, value: (e: AuditEntry) => e.agent },
        { name: "KEY", width: 3, value: (e: AuditEntry) => e.key, truncate: false },
      ]
    : [
        { name: "TIME", width: 19, value: (e: AuditEntry) => e.timestamp.replace(/\.\d{3}Z$/, "Z") },
        { name: "ACTION", width: 6, value: (e: AuditEntry) => e.action.toUpperCase() },
        { name: "AGENT", width: 18, value: (e: AuditEntry) => e.agent },
        { name: "KEY", width: 3, value: (e: AuditEntry) => e.key, truncate: false },
      ];

  const lines = page.items.length > 0 ? formatTable(columns, page.items) : [];
  if (lines.length > 0) lines.push("");
  lines.push(formatPageSummary(page, options.noun ?? "audit entry"));
  if (page.nextCursor !== null) {
    lines.push(formatNextHint(options.mode ?? "cli", options.command, page));
  }
  lines.push(formatGenericDetailHint(options.mode ?? "cli", "wider fields"));
  return lines.join("\n");
}

export function formatUserRows(
  page: Page<User>,
  options: { command: string; verbose?: boolean; noun?: string; mode?: OutputMode }
): string {
  const verbose = options.verbose ?? false;
  const columns = verbose
    ? [
        { name: "ID", width: 36, value: (u: User) => u.id },
        { name: "TYPE", width: 8, value: (u: User) => u.type },
        { name: "NAME", width: 28, value: (u: User) => u.name },
        { name: "LAST SEEN", width: 10, value: (u: User) => formatDate(u.last_seen) },
      ]
    : [
        { name: "ID", width: 28, value: (u: User) => u.id },
        { name: "TYPE", width: 8, value: (u: User) => u.type },
        { name: "NAME", width: 28, value: (u: User) => u.name },
      ];

  const lines = page.items.length > 0 ? formatTable(columns, page.items) : [];
  if (lines.length > 0) lines.push("");
  lines.push(formatPageSummary(page, options.noun ?? "user"));
  if (page.nextCursor !== null) {
    lines.push(formatNextHint(options.mode ?? "cli", options.command, page));
  }
  lines.push(formatGenericDetailHint(options.mode ?? "cli", "more fields"));
  return lines.join("\n");
}

export function formatKeyListSummary(label: string, keys: string[], limit = 10): string {
  if (keys.length === 0) return `${label}: 0`;
  const visible = keys.slice(0, limit).map((key) => truncateMiddle(key, 48));
  const suffix = keys.length > visible.length ? `, ... +${keys.length - visible.length} more` : "";
  return `${label} (${keys.length}): ${visible.join(", ")}${suffix}`;
}

export function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value);
}

function parseBoundedInteger(
  raw: string | number | undefined,
  name: string,
  fallback: number,
  bounds: { min: number; max?: number }
): number {
  if (raw === undefined || raw === "") return fallback;
  const value = typeof raw === "number" ? raw : Number(raw.trim());
  if (
    (typeof raw === "string" && !/^\d+$/.test(raw.trim())) ||
    !Number.isInteger(value) ||
    value < bounds.min
  ) {
    throw new Error(`Invalid --${name}: expected an integer >= ${bounds.min}`);
  }
  return bounds.max === undefined ? value : Math.min(value, bounds.max);
}

type TableColumn<T> = {
  name: string;
  width: number;
  value: (item: T) => string;
  truncate?: boolean;
};

function formatTable<T>(
  columns: Array<TableColumn<T>>,
  rows: T[]
): string[] {
  const header = columns.map((c) => c.name.padEnd(c.width)).join("  ").trimEnd();
  const divider = columns.map((c) => "-".repeat(c.width)).join("  ").trimEnd();
  const lines = [header, divider];
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => formatCell(c.value(row), c))
        .join("  ")
        .trimEnd()
    );
  }
  return lines;
}

function formatPageSummary<T>(page: Page<T>, noun: string): string {
  const plural = page.total === 1 ? noun : pluralize(noun);
  if (page.total === 0) return `0 ${plural}.`;
  if (page.items.length === 0) return `No ${pluralize(noun)} at cursor ${page.cursor}; total ${page.total}.`;
  const rangeStart = page.items.length === 0 ? 0 : page.cursor + 1;
  const rangeEnd = page.cursor + page.items.length;
  return `Showing ${rangeStart}-${rangeEnd} of ${page.total} ${plural}.`;
}

function pluralize(noun: string): string {
  if (noun.endsWith("entry")) return `${noun.slice(0, -"entry".length)}entries`;
  return `${noun}s`;
}

function formatDate(value?: string | null): string {
  return value ? value.slice(0, 10) : "-";
}

function truncateMiddle(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  const keep = width - 3;
  const head = Math.ceil(keep * 0.65);
  const tail = keep - head;
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}

function formatCell<T>(value: string, column: TableColumn<T>): string {
  const formatted = column.truncate === false ? value : truncateMiddle(value, column.width);
  return formatted.padEnd(column.width);
}

function formatNextHint<T>(mode: OutputMode, command: string, page: Page<T>): string {
  if (mode === "mcp") {
    return `Next: call ${command} with ${JSON.stringify({ cursor: page.nextCursor, limit: page.limit })}`;
  }
  return `Next: ${command} --cursor ${page.nextCursor} --limit ${page.limit}`;
}

function formatSecretDetailHint(mode: OutputMode, detailCommand: string): string {
  if (mode === "mcp") {
    return `Details: call ${detailCommand} with ${JSON.stringify({ key: "<key>" })}; set verbose:true for more fields.`;
  }
  return `Details: ${detailCommand} <key>; add --verbose for more fields; add --json for machine output.`;
}

function formatGenericDetailHint(mode: OutputMode, fieldDescription: string): string {
  if (mode === "mcp") {
    return `Details: set verbose:true for ${fieldDescription}.`;
  }
  return `Details: add --verbose for ${fieldDescription}; add --json for machine output.`;
}
