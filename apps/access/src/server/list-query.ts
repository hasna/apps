import type { Context } from "hono";

/** Shared pagination/filter parsing for /v1 list endpoints. */

export interface ListQuery {
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

export function parseListQuery(c: Context, allowed: string[]): ListQuery {
  const q: ListQuery = {};
  const limit = c.req.query("limit");
  const offset = c.req.query("offset");
  if (limit !== undefined) q.limit = Number.parseInt(limit, 10);
  if (offset !== undefined) q.offset = Number.parseInt(offset, 10);
  for (const key of allowed) {
    const value = c.req.query(key);
    if (value !== undefined) q[key] = value;
  }
  return q;
}
