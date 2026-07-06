// Shared pagination/filter parsing for /v1 list endpoints. Kept intentionally
// small; list ops return arrays and may be sliced with ?limit/?offset.

export interface ListParams {
  limit: number | null;
  offset: number;
}

export function parseListParams(query: Record<string, string>): ListParams {
  const limitRaw = query["limit"];
  const offsetRaw = query["offset"];
  const limit = limitRaw ? Math.max(1, Math.min(500, Number.parseInt(limitRaw, 10) || 50)) : null;
  const offset = offsetRaw ? Math.max(0, Number.parseInt(offsetRaw, 10) || 0) : 0;
  return { limit, offset };
}

export function applyList<T>(items: T[], params: ListParams): T[] {
  if (params.limit === null && params.offset === 0) return items;
  return params.limit === null ? items.slice(params.offset) : items.slice(params.offset, params.offset + params.limit);
}
