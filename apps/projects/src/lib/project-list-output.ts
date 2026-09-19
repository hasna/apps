import type { Workspace } from "../types/workspace.js";

export const PROJECT_LIST_DETAILS = ["compact", "full"] as const;
export type ProjectListDetail = (typeof PROJECT_LIST_DETAILS)[number];

export const PROJECT_QUERY_SCOPES = ["identity", "discovery", "structured", "all"] as const;
export type ProjectQueryScope = (typeof PROJECT_QUERY_SCOPES)[number];

export const PROJECT_LIST_FIELDS = [
  "id",
  "slug",
  "name",
  "status",
  "kind",
  "path",
  "canonical_machine",
  "root_id",
  "recipe_id",
  "git_remote",
  "updated_at",
] as const;
export type ProjectListField = (typeof PROJECT_LIST_FIELDS)[number];

export const DEFAULT_PROJECT_LIST_FIELDS: readonly ProjectListField[] = [
  "id",
  "slug",
  "name",
  "status",
  "kind",
  "path",
];

export const DEFAULT_PROJECT_LIST_MAX_BYTES = 32 * 1024;
export const MIN_PROJECT_LIST_MAX_BYTES = 1024;
export const MAX_PROJECT_LIST_MAX_BYTES = 256 * 1024;
export const MAX_PROJECT_QUERY_LENGTH = 512;
export const MAX_PROJECT_QUERY_TAGS = 50;
export const MAX_PROJECT_QUERY_TAG_LENGTH = 128;
export const PROJECT_LIST_V2_CONTRACT = "projects.list.v2" as const;

const PROJECT_LIST_FIELD_SET = new Set<string>(PROJECT_LIST_FIELDS);
const PROJECT_QUERY_SCOPE_SET = new Set<string>(PROJECT_QUERY_SCOPES);

export function isProjectQueryScope(value: string): value is ProjectQueryScope {
  return PROJECT_QUERY_SCOPE_SET.has(value);
}

export function parseProjectQueryScope(
  value: string | undefined,
  fallback: ProjectQueryScope,
): ProjectQueryScope {
  if (!value) return fallback;
  if (isProjectQueryScope(value)) return value;
  throw new Error(`Unknown project query scope: ${value}. Expected one of: ${PROJECT_QUERY_SCOPES.join(", ")}`);
}

export function parseProjectListDetail(value: string | undefined): ProjectListDetail | undefined {
  if (value === undefined) return undefined;
  if ((PROJECT_LIST_DETAILS as readonly string[]).includes(value)) return value as ProjectListDetail;
  throw new Error(`Unknown project list detail: ${value}. Expected compact or full.`);
}

export function projectListMaxBytes(value: number | undefined): number {
  const resolved = value ?? DEFAULT_PROJECT_LIST_MAX_BYTES;
  if (!Number.isInteger(resolved) || resolved < MIN_PROJECT_LIST_MAX_BYTES || resolved > MAX_PROJECT_LIST_MAX_BYTES) {
    throw new Error(
      `Project list max bytes must be an integer from ${MIN_PROJECT_LIST_MAX_BYTES} to ${MAX_PROJECT_LIST_MAX_BYTES}.`,
    );
  }
  return resolved;
}

function fieldNames(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  const values = typeof value === "string" ? value.split(",") : value;
  return values.map((field) => field.trim()).filter(Boolean);
}

export function resolveProjectListFields(
  value: string | readonly string[] | undefined,
): ProjectListField[] {
  const requested = fieldNames(value);
  if (value === undefined) return [...DEFAULT_PROJECT_LIST_FIELDS];
  if (requested.length === 0) throw new Error("Project list fields must include at least one field.");
  for (const field of requested) {
    if (!PROJECT_LIST_FIELD_SET.has(field)) {
      throw new Error(`Unknown project list field: ${field}. Expected one of: ${PROJECT_LIST_FIELDS.join(", ")}`);
    }
  }
  return [...new Set(["id", ...requested])] as ProjectListField[];
}

export function projectListRow(
  project: Workspace,
  fields: readonly ProjectListField[] = DEFAULT_PROJECT_LIST_FIELDS,
): Record<string, unknown> {
  const selected = [...new Set(["id", ...fields])] as ProjectListField[];
  const values: Record<ProjectListField, unknown> = {
    id: project.id,
    slug: project.slug,
    name: project.name,
    status: project.status,
    kind: project.kind,
    path: project.primary_path,
    canonical_machine: project.canonical_machine,
    root_id: project.root_id,
    recipe_id: project.recipe_id,
    git_remote: project.git_remote,
    updated_at: project.updated_at,
  };
  return Object.fromEntries(selected.map((field) => [field, values[field]]));
}

export interface ProjectListEnvelopeInput<T> {
  projects: T[];
  total: number;
  offset: number;
  limit: number | null;
  detail: ProjectListDetail;
  fields: readonly ProjectListField[] | null;
  queryScope: ProjectQueryScope;
  nextArguments?: Record<string, unknown>;
  hasMore?: boolean;
  complete?: boolean;
  nextOffset?: number | null;
  cursor?: string | null;
  nextCursor?: string | null;
  nextCursorForCount?: (count: number) => string | null;
  snapshot?: string | null;
  opaqueCursor?: boolean;
}

export interface ProjectListEnvelope<T> {
  projects: T[];
  count: number;
  total: number;
  offset: number;
  limit: number | null;
  cursor: string | null;
  next_cursor: string | null;
  next_offset: number | null;
  snapshot: string | null;
  has_more: boolean;
  complete: boolean;
  detail: ProjectListDetail;
  fields: readonly ProjectListField[] | null;
  query_scope: ProjectQueryScope;
  next_arguments: Record<string, unknown> | null;
}

export interface BoundedProjectListEnvelope<T> extends ProjectListEnvelope<T> {
  max_bytes: number;
  response_bytes: number;
  truncated: boolean;
  truncation_reason: "max_bytes" | null;
  omitted_from_page: number;
}

export function buildProjectListEnvelope<T>(input: ProjectListEnvelopeInput<T>): ProjectListEnvelope<T> {
  const count = input.projects.length;
  const hasMore = input.hasMore ?? input.offset + count < input.total;
  const positionalNextOffset = hasMore ? input.nextOffset ?? input.offset + count : null;
  const nextOffset = input.opaqueCursor ? null : positionalNextOffset;
  const nextCursor = hasMore ? input.nextCursor ?? null : null;
  const complete = input.complete ?? (input.offset === 0 && !hasMore && count === input.total);
  const nextArguments = hasMore
    ? {
        ...(input.nextArguments ?? {}),
        ...(input.opaqueCursor ? { cursor: nextCursor } : { offset: nextOffset }),
        ...(input.limit === null ? {} : { limit: input.limit }),
      }
    : null;
  return {
    projects: input.projects,
    count,
    total: input.total,
    offset: input.offset,
    limit: input.limit,
    cursor: input.cursor ?? null,
    next_cursor: nextCursor,
    next_offset: nextOffset,
    snapshot: input.snapshot ?? null,
    has_more: hasMore,
    complete,
    detail: input.detail,
    fields: input.fields,
    query_scope: input.queryScope,
    next_arguments: nextArguments,
  };
}

export function stringifyProjectListOutput(value: unknown, pretty = false): string {
  return `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
}

function withResponseBytes<T>(
  envelope: Omit<BoundedProjectListEnvelope<T>, "response_bytes">,
  pretty: boolean,
): BoundedProjectListEnvelope<T> {
  const result = { ...envelope, response_bytes: 0 } as BoundedProjectListEnvelope<T>;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = Buffer.byteLength(`${JSON.stringify(result, null, pretty ? 2 : undefined)}\n`);
    if (bytes === result.response_bytes) return result;
    result.response_bytes = bytes;
  }
  return result;
}

export function buildBoundedProjectListOutput<T>(
  input: ProjectListEnvelopeInput<T>,
  options: { maxBytes?: number; pretty?: boolean } = {},
): { envelope: BoundedProjectListEnvelope<T>; text: string } {
  const maxBytes = projectListMaxBytes(options.maxBytes);
  const pretty = options.pretty ?? false;
  const sourceRows = input.projects;

  for (let count = sourceRows.length; count >= 0; count -= 1) {
    const projects = sourceRows.slice(0, count);
    const clipped = count < sourceRows.length;
    const hasMore = clipped || (input.hasMore ?? input.offset + sourceRows.length < input.total);
    const complete = !clipped && (input.complete ?? (input.offset === 0 && !hasMore && sourceRows.length === input.total));
    const nextOffset = hasMore
      ? clipped
        ? input.offset + count
        : input.nextOffset ?? input.offset + sourceRows.length
      : null;
    const nextCursor = hasMore && input.nextCursorForCount
      ? input.nextCursorForCount(count)
      : hasMore ? input.nextCursor ?? null : null;
    const base = buildProjectListEnvelope({
      ...input,
      projects,
      hasMore,
      complete,
      nextOffset,
      nextCursor,
    });
    const envelope = withResponseBytes({
      ...base,
      max_bytes: maxBytes,
      truncated: clipped,
      truncation_reason: clipped ? "max_bytes" : null,
      omitted_from_page: sourceRows.length - count,
    }, pretty);
    const text = stringifyProjectListOutput(envelope, pretty);
    if (count === 0 && sourceRows.length > 0) {
      throw new Error(
        `One project list row exceeds the ${maxBytes}-byte limit; use compact detail, fewer fields, or a larger max_bytes value.`,
      );
    }
    if (Buffer.byteLength(text) <= maxBytes) return { envelope, text };
    if (count === 0) {
      throw new Error(
        `Project list response metadata exceeds the ${maxBytes}-byte limit; narrow the query or request fewer fields.`,
      );
    }
  }

  throw new Error("Project list response could not be bounded.");
}
