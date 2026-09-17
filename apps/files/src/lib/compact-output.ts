import { FILES_API_MAX_PAGE_SIZE } from "./api-pagination.js";
import type { FileWithTags, SearchResult } from "../types/index.js";

export type FileOutputDetail = "compact" | "full";

export const DEFAULT_COMPACT_FILE_MAX_BYTES = 32 * 1024;
export const MAX_COMPACT_FILE_MAX_BYTES = 1024 * 1024;
export const MAX_ALL_FILE_ROWS = 5_000;
export const DEFAULT_ALL_FILE_MAX_BYTES = MAX_COMPACT_FILE_MAX_BYTES;

export const FILE_LIST_FIELDS = [
  "id",
  "source_id",
  "machine_id",
  "path",
  "name",
  "original_name",
  "canonical_name",
  "ext",
  "size",
  "mime",
  "description",
  "hash",
  "status",
  "indexed_at",
  "modified_at",
  "created_at",
  "tags",
] as const;

export const FILE_SEARCH_FIELDS = [
  ...FILE_LIST_FIELDS,
  "rank",
  "search_match_sources",
  "search_document_kinds",
  "search_document_count",
] as const;

export type FileOutputField = (typeof FILE_SEARCH_FIELDS)[number];

export const FILE_COMPACT_FIELDS = [
  "id",
  "name",
  "path",
  "ext",
  "size",
  "mime",
  "status",
  "source_id",
] as const satisfies readonly FileOutputField[];

export const SEARCH_COMPACT_FIELDS = [
  ...FILE_COMPACT_FIELDS,
  "rank",
  "search_match_sources",
  "search_document_kinds",
  "search_document_count",
] as const satisfies readonly FileOutputField[];

const LIST_FIELD_SET = new Set<string>(FILE_LIST_FIELDS);
const SEARCH_FIELD_SET = new Set<string>(FILE_SEARCH_FIELDS);

const FIELD_STRING_LIMITS: Partial<Record<FileOutputField, number>> = {
  source_id: 256,
  machine_id: 256,
  path: 1024,
  name: 256,
  original_name: 256,
  canonical_name: 256,
  ext: 32,
  mime: 128,
  description: 512,
  hash: 256,
  status: 32,
  indexed_at: 64,
  modified_at: 64,
  created_at: 64,
};
const MAX_ARRAY_ITEMS = 20;
const MAX_ARRAY_STRING_CHARS = 128;

export interface FilePageMeta {
  count: number;
  limit: number;
  offset: number;
  next_offset: number | null;
  has_more: boolean;
  end_reached: boolean;
  complete: boolean;
  all: boolean;
  detail: FileOutputDetail;
  fields?: FileOutputField[];
  byte_length?: number;
  max_bytes?: number;
  byte_limited?: boolean;
  truncated_fields?: FileOutputField[];
}

export interface FilePage<T = unknown> {
  items: T[];
  _meta: FilePageMeta;
}

export interface BuildFilePageOptions {
  limit: number;
  offset: number;
  detail: FileOutputDetail;
  fields?: readonly FileOutputField[];
  maxBytes?: number;
  pretty?: boolean;
  trailingNewline?: boolean;
  all?: boolean;
}

export function parseFileDetail(value: string | undefined): FileOutputDetail {
  if (value === undefined || value === "compact") return "compact";
  if (value === "full") return "full";
  throw new Error(`Invalid detail "${value}": expected compact or full`);
}

export function parseFileFields(
  value: string | readonly string[] | undefined,
  kind: "list" | "search",
): FileOutputField[] {
  const defaults = kind === "search" ? SEARCH_COMPACT_FIELDS : FILE_COMPACT_FIELDS;
  const requested = typeof value === "string" ? value.split(",") : value ?? defaults;
  const allowed = kind === "search" ? SEARCH_FIELD_SET : LIST_FIELD_SET;
  const fields: FileOutputField[] = [];
  for (const raw of requested) {
    const field = raw.trim();
    if (!field) continue;
    if (!allowed.has(field)) {
      const names = kind === "search" ? FILE_SEARCH_FIELDS : FILE_LIST_FIELDS;
      throw new Error(`Unknown ${kind} file field "${field}". Expected one of: ${names.join(", ")}`);
    }
    const typed = field as FileOutputField;
    if (!fields.includes(typed)) fields.push(typed);
  }
  if (fields.length === 0) throw new Error("At least one file field is required");
  if (!fields.includes("id")) fields.unshift("id");
  return fields;
}

export function validateFileProjection(
  detail: FileOutputDetail,
  fields: string | readonly string[] | undefined,
  kind: "list" | "search",
): FileOutputField[] | undefined {
  if (detail === "full") {
    if (fields !== undefined) throw new Error("fields cannot be combined with detail=full");
    return undefined;
  }
  return parseFileFields(fields, kind);
}

export function normalizeFileOutputMaxBytes(value: number | undefined): number {
  const maxBytes = value ?? DEFAULT_COMPACT_FILE_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_COMPACT_FILE_MAX_BYTES) {
    throw new Error(`max_bytes must be an integer between 1024 and ${MAX_COMPACT_FILE_MAX_BYTES}`);
  }
  return maxBytes;
}

/** Fetch one logical page plus at most one continuation probe without asking a
 * bounded `/v1` server for 501 rows. */
export async function fetchFilePageRows<T>(
  read: (limit: number, offset: number) => Promise<T[]>,
  limit: number,
  offset: number,
): Promise<T[]> {
  if (limit < FILES_API_MAX_PAGE_SIZE) return read(limit + 1, offset);
  const rows = await read(limit, offset);
  if (rows.length < limit) return rows;
  const probe = await read(1, offset + rows.length);
  return probe.length ? [...rows, probe[0]!] : rows;
}

/**
 * Exhaust a query in bounded server pages. A successful return proves the
 * whole query was read from offset zero. If more than `maxRows` exist, refuse
 * rather than returning a success-shaped partial result.
 */
export async function fetchAllFileRows<T>(
  read: (limit: number, offset: number) => Promise<T[]>,
  maxRows = MAX_ALL_FILE_ROWS,
): Promise<T[]> {
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error("maxRows must be a positive integer");
  const rows: T[] = [];
  while (rows.length < maxRows) {
    const pageLimit = Math.min(FILES_API_MAX_PAGE_SIZE, maxRows - rows.length);
    const page = await read(pageLimit, rows.length);
    rows.push(...page.slice(0, pageLimit));
    if (page.length < pageLimit) return rows;
  }
  const probe = await read(1, rows.length);
  if (probe.length > 0) {
    throw new Error(
      `Exhaustive file output exceeds the hard safety limit of ${maxRows} rows; use paginated output instead`,
    );
  }
  return rows;
}

export function buildFilePage<T extends FileWithTags | SearchResult>(
  rows: readonly T[],
  options: BuildFilePageOptions,
): FilePage<T | Record<string, unknown>> {
  if (options.detail === "full" && options.fields !== undefined) {
    throw new Error("fields cannot be combined with detail=full");
  }

  const requestedRows = rows.slice(0, options.limit);
  let truncatedFields = new Set<FileOutputField>();
  let items: Array<T | Record<string, unknown>>;
  let fields: FileOutputField[] | undefined;
  if (options.detail === "compact") {
    fields = [...(options.fields ?? FILE_COMPACT_FIELDS)];
    items = requestedRows.map((row) => projectFile(row, fields!, truncatedFields));
  } else {
    items = [...requestedRows];
  }

  const sourceHasMore = rows.length > options.limit;
  const maxBytes = options.maxBytes;
  let byteLimited = false;
  let page = makePage(items, options, sourceHasMore, fields, truncatedFields, maxBytes, byteLimited);

  if (maxBytes !== undefined) {
    while (page._meta.byte_length! > maxBytes && items.length > 0) {
      items = items.slice(0, -1);
      byteLimited = true;
      if (options.detail === "compact") {
        truncatedFields = new Set<FileOutputField>();
        items = requestedRows.slice(0, items.length).map((row) => projectFile(row, fields!, truncatedFields));
      }
      page = makePage(items, options, true, fields, truncatedFields, maxBytes, byteLimited);
    }
    if (items.length === 0 && requestedRows.length > 0) {
      throw new Error(`The first projected file exceeds max_bytes=${maxBytes}; request fewer fields or a larger max_bytes`);
    }
  }

  return page;
}

function makePage<T>(
  items: T[],
  options: BuildFilePageOptions,
  hasMore: boolean,
  fields: FileOutputField[] | undefined,
  truncatedFields: Set<FileOutputField>,
  maxBytes: number | undefined,
  byteLimited: boolean,
): FilePage<T> {
  const page: FilePage<T> = {
    items,
    _meta: {
      count: items.length,
      limit: options.limit,
      offset: options.offset,
      next_offset: hasMore ? options.offset + items.length : null,
      has_more: hasMore,
      end_reached: !hasMore,
      complete: !hasMore && options.offset === 0,
      all: Boolean(options.all),
      detail: options.detail,
      ...(fields ? { fields } : {}),
      ...(maxBytes !== undefined ? { byte_length: 0, max_bytes: maxBytes, byte_limited: byteLimited } : {}),
      ...(truncatedFields.size ? { truncated_fields: [...truncatedFields].sort() } : {}),
    },
  };
  if (maxBytes !== undefined) stabilizeByteLength(page, options.pretty, options.trailingNewline);
  return page;
}

function stabilizeByteLength(page: FilePage, pretty = false, trailingNewline = false): void {
  let previous = -1;
  for (let i = 0; i < 4; i++) {
    const length = Buffer.byteLength(JSON.stringify(page, null, pretty ? 2 : undefined))
      + (trailingNewline ? 1 : 0);
    page._meta.byte_length = length;
    if (length === previous) return;
    previous = length;
  }
}

export function projectFile(
  file: FileWithTags | SearchResult,
  fields: readonly FileOutputField[],
  truncatedFields: Set<FileOutputField> = new Set(),
): Record<string, unknown> {
  const record = file as unknown as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    const value = record[field];
    projected[field] = compactFieldValue(field, value, truncatedFields);
  }
  return projected;
}

function compactFieldValue(
  field: FileOutputField,
  value: unknown,
  truncatedFields: Set<FileOutputField>,
): unknown {
  if (value === undefined) return null;
  if (typeof value === "string") {
    const limit = FIELD_STRING_LIMITS[field];
    if (limit !== undefined && Array.from(value).length > limit) {
      truncatedFields.add(field);
      return `${Array.from(value).slice(0, Math.max(0, limit - 1)).join("")}…`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const clipped = value.slice(0, MAX_ARRAY_ITEMS).map((entry) => {
      if (typeof entry !== "string" || Array.from(entry).length <= MAX_ARRAY_STRING_CHARS) return entry;
      truncatedFields.add(field);
      return `${Array.from(entry).slice(0, MAX_ARRAY_STRING_CHARS - 1).join("")}…`;
    });
    if (value.length > MAX_ARRAY_ITEMS) truncatedFields.add(field);
    return clipped;
  }
  return value;
}

export function filePageJson(page: FilePage<unknown>, pretty = false): string {
  return JSON.stringify(page, null, pretty ? 2 : undefined);
}
