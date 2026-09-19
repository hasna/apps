export const MCP_COMPACT_MAX_BYTES = 32 * 1024;
export const MCP_FULL_MAX_BYTES = 64 * 1024;
export const MCP_EXPLICIT_MAX_BYTES = 1024 * 1024;

export type McpOutputDetail = "compact" | "full";

export function mcpMaxBytes(value: unknown, detail: McpOutputDetail): number {
  if (value === undefined) return detail === "full" ? MCP_FULL_MAX_BYTES : MCP_COMPACT_MAX_BYTES;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > MCP_EXPLICIT_MAX_BYTES) {
    throw new Error(`max_bytes must be an integer from 1024 to ${MCP_EXPLICIT_MAX_BYTES}`);
  }
  return parsed;
}

interface BoundedMcpOutputArgs<T> {
  collection: string;
  receipt: string;
  items: T[];
  offset: number;
  limit: number;
  sourceHasMore: boolean;
  detail: McpOutputDetail;
  maxBytes: number;
  metadata?: Record<string, unknown>;
  nextArguments?: Record<string, unknown>;
  includeDetailInNextArguments?: boolean;
}

export interface BoundedMcpOutput {
  text: string;
  selectedCount: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export function boundedMcpOutput<T>(args: BoundedMcpOutputArgs<T>): BoundedMcpOutput {
  const makeEnvelope = (items: T[], byteTruncated: boolean, omitted: number): Record<string, unknown> => {
    const hasMore = byteTruncated || args.sourceHasMore;
    const nextOffset = hasMore ? args.offset + items.length : null;
    const envelope: Record<string, unknown> = {
      [args.collection]: items,
      _meta: {
        receipt: args.receipt,
        count: items.length,
        limit: args.limit,
        offset: args.offset,
        next_offset: nextOffset,
        has_more: hasMore,
        complete: args.offset === 0 && !hasMore,
        detail: args.detail,
        max_bytes: args.maxBytes,
        response_bytes: 0,
        truncated: hasMore,
        truncation_reason: byteTruncated ? "max_bytes" : args.sourceHasMore ? "limit" : null,
        omitted_from_page: omitted,
        next_arguments: nextOffset === null
          ? null
          : {
              offset: nextOffset,
              limit: args.limit,
              ...(args.includeDetailInNextArguments !== false && args.detail === "full" ? { detail: "full" } : {}),
              max_bytes: args.maxBytes,
              ...args.nextArguments,
            },
        continuation_scope: "unchanged_snapshot",
        ...args.metadata,
      },
    };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bytes = Buffer.byteLength(JSON.stringify(envelope));
      const meta = envelope["_meta"] as Record<string, unknown>;
      if (meta["response_bytes"] === bytes) break;
      meta["response_bytes"] = bytes;
    }
    return envelope;
  };

  for (let count = args.items.length; count >= 0; count -= 1) {
    const byteTruncated = count < args.items.length;
    const envelope = makeEnvelope(args.items.slice(0, count), byteTruncated, args.items.length - count);
    const text = JSON.stringify(envelope);
    if (Buffer.byteLength(text) > args.maxBytes) continue;
    if (count === 0 && args.items.length > 0) {
      throw new Error(`One ${args.detail} result exceeds max_bytes=${args.maxBytes}; request compact detail or a larger max_bytes value`);
    }
    const meta = envelope["_meta"] as Record<string, unknown>;
    return {
      text,
      selectedCount: count,
      hasMore: meta["has_more"] === true,
      nextOffset: typeof meta["next_offset"] === "number" ? meta["next_offset"] : null,
    };
  }
  throw new Error(`Response metadata exceeds max_bytes=${args.maxBytes}`);
}
