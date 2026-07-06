// Shared pagination/filter parsing for /v1 list endpoints.

export interface ListQuery {
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export function parseListQuery(url: URL): ListQuery {
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  return { limit, offset };
}

/** Collect non-pagination query params into a flat input object. */
export function queryToInput(url: URL): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "limit" || key === "offset") continue;
    input[key] = value;
  }
  return input;
}
