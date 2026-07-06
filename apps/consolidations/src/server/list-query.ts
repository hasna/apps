// Shared list query parsing (pagination + filters) for /v1 list routes.

export interface ListQuery {
  limit: number;
  offset: number;
  filters: Record<string, string>;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function parseListQuery(query: Record<string, string | undefined>): ListQuery {
  const limitRaw = Number.parseInt(query["limit"] ?? "", 10);
  const offsetRaw = Number.parseInt(query["offset"] ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && key !== "limit" && key !== "offset") filters[key] = value;
  }
  return { limit, offset, filters };
}
