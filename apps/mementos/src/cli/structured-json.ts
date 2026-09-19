import { truncateText } from "./helpers.js";
import type { Agent, Memory, Project, MemorySearchResult } from "../types/index.js";

export const STRUCTURED_PAGE_MAX_ROWS = 1_000;
export const STRUCTURED_ALL_MAX_ROWS = 100_000;
export const STRUCTURED_DEFAULT_MAX_BYTES = 32 * 1024;
export const STRUCTURED_FULL_MAX_BYTES = 64 * 1024;
export const STRUCTURED_ALL_MAX_BYTES = 64 * 1024 * 1024;
export const STRUCTURED_MIN_MAX_BYTES = 1024;

export type StructuredDetail = "compact" | "full";

export interface StructuredCollectionMeta {
  receipt: string;
  count: number;
  limit: number | null;
  offset: number;
  next_cursor: number | null;
  has_more: boolean;
  complete: boolean;
  all: boolean;
  detail: StructuredDetail;
  max_rows: number;
  max_bytes: number;
  response_bytes: number;
  truncated: boolean;
  truncation_reason: "limit" | "cursor" | "max_bytes" | null;
  omitted_from_page: number;
  next_arguments: Record<string, unknown> | null;
  continuation_scope: "unchanged_snapshot";
}

export function structuredMaxBytes(
  value: unknown,
  opts: { all: boolean; detail: StructuredDetail },
): number {
  const fallback = opts.all
    ? STRUCTURED_ALL_MAX_BYTES
    : opts.detail === "full"
      ? STRUCTURED_FULL_MAX_BYTES
      : STRUCTURED_DEFAULT_MAX_BYTES;
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (
    !Number.isInteger(parsed)
    || parsed < STRUCTURED_MIN_MAX_BYTES
    || parsed > STRUCTURED_ALL_MAX_BYTES
  ) {
    throw new Error(
      `--max-bytes must be an integer from ${STRUCTURED_MIN_MAX_BYTES} to ${STRUCTURED_ALL_MAX_BYTES}`,
    );
  }
  return parsed;
}

export function structuredPageLimit(value: unknown, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > STRUCTURED_PAGE_MAX_ROWS) {
    throw new Error(`--limit must be an integer from 1 to ${STRUCTURED_PAGE_MAX_ROWS}`);
  }
  return parsed;
}

export function compactMemory(memory: Memory, opts: { history?: boolean } = {}): Record<string, unknown> {
  const value = truncateText(memory.summary || memory.value, 240);
  return {
    id: memory.id,
    key: memory.key,
    value,
    scope: memory.scope,
    category: memory.category,
    importance: memory.importance,
    status: memory.status,
    pinned: memory.pinned,
    ...(Array.isArray(memory.tags) && memory.tags.length ? { tags: memory.tags.slice(0, 10) } : {}),
    ...(memory.agent_id ? { agent_id: memory.agent_id } : {}),
    ...(memory.project_id ? { project_id: memory.project_id } : {}),
    ...(memory.session_id ? { session_id: memory.session_id } : {}),
    ...(opts.history && memory.accessed_at ? { accessed_at: memory.accessed_at } : {}),
    updated_at: memory.updated_at,
  };
}

export function compactProject(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    path: truncateText(project.path, 240),
    ...(project.description ? { description: truncateText(project.description, 240) } : {}),
    ...(project.memory_prefix ? { memory_prefix: project.memory_prefix } : {}),
    updated_at: project.updated_at,
  };
}

export function compactAgent(agent: Agent): Record<string, unknown> {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role || "agent",
    ...(agent.description ? { description: truncateText(agent.description, 240) } : {}),
    ...(agent.active_project_id ? { active_project_id: agent.active_project_id } : {}),
    last_seen_at: agent.last_seen_at,
  };
}

export function compactSearchResult(result: MemorySearchResult): Record<string, unknown> {
  return {
    memory: compactMemory(result.memory),
    score: result.score,
    match_type: result.match_type,
    ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
    ...(result.highlights?.length
      ? { highlights: result.highlights.slice(0, 3).map((highlight) => ({
          field: highlight.field,
          snippet: truncateText(highlight.snippet, 240),
        })) }
      : {}),
  };
}

interface CollectionArgs<T> {
  collection: string;
  receipt: string;
  items: T[];
  offset: number;
  limit: number;
  sourceHasMore: boolean;
  all: boolean;
  detail: StructuredDetail;
  maxBytes: number;
  nextArguments?: Record<string, unknown>;
  includeDetailInNextArguments?: boolean;
}

function makeEnvelope<T>(
  args: CollectionArgs<T>,
  items: T[],
  byteTruncated: boolean,
  omittedFromPage: number,
): Record<string, unknown> {
  const hasMore = byteTruncated || args.sourceHasMore;
  const complete = args.offset === 0 && !hasMore;
  const nextCursor = hasMore ? args.offset + items.length : null;
  const envelope: Record<string, unknown> = {
    [args.collection]: items,
    _meta: {
      receipt: args.receipt,
      count: items.length,
      limit: args.all ? null : args.limit,
      offset: args.offset,
      next_cursor: nextCursor,
      has_more: hasMore,
      complete,
      all: args.all,
      detail: args.detail,
      max_rows: args.all ? STRUCTURED_ALL_MAX_ROWS : STRUCTURED_PAGE_MAX_ROWS,
      max_bytes: args.maxBytes,
      response_bytes: 0,
      truncated: hasMore,
      truncation_reason: byteTruncated
        ? "max_bytes"
        : args.sourceHasMore
          ? "limit"
          : null,
      omitted_from_page: omittedFromPage,
      next_arguments: nextCursor === null
        ? null
        : {
            cursor: nextCursor,
            limit: args.limit,
            ...(args.includeDetailInNextArguments !== false && args.detail === "full" ? { full: true } : {}),
            max_bytes: args.maxBytes,
            ...args.nextArguments,
          },
      continuation_scope: "unchanged_snapshot",
    } satisfies StructuredCollectionMeta,
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = Buffer.byteLength(`${JSON.stringify(envelope)}\n`);
    const meta = envelope["_meta"] as StructuredCollectionMeta;
    if (bytes === meta.response_bytes) break;
    meta.response_bytes = bytes;
  }
  return envelope;
}

export function structuredCollectionOutput<T>(args: CollectionArgs<T>): string {
  const complete = makeEnvelope(args, args.items, false, 0);
  const completeText = `${JSON.stringify(complete)}\n`;
  if (Buffer.byteLength(completeText) <= args.maxBytes) return completeText;

  if (args.all) {
    throw new Error(
      `Exhaustive structured output exceeds the hard safety limit of ${args.maxBytes} bytes; use paginated JSON output or raise --max-bytes explicitly`,
    );
  }

  for (let count = args.items.length - 1; count >= 0; count -= 1) {
    const envelope = makeEnvelope(
      { ...args, sourceHasMore: true },
      args.items.slice(0, count),
      true,
      args.items.length - count,
    );
    const text = `${JSON.stringify(envelope)}\n`;
    if (Buffer.byteLength(text) > args.maxBytes) continue;
    if (count === 0 && args.items.length > 0) {
      throw new Error(
        `One structured row exceeds --max-bytes=${args.maxBytes}; use compact detail or raise --max-bytes`,
      );
    }
    return text;
  }

  throw new Error(`Structured output metadata exceeds --max-bytes=${args.maxBytes}`);
}
