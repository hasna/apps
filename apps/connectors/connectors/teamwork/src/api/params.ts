import type { ListParams } from '../types';

/** API v3 path prefix for all Teamwork Projects endpoints. */
export const V3 = '/projects/api/v3';

/** Translate the shared ListParams into Teamwork v3 query parameters. */
export function toQuery(params?: ListParams): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};
  if (!params) return query;
  if (params.page !== undefined) query.page = params.page;
  if (params.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params.searchTerm) query.searchTerm = params.searchTerm;
  if (params.orderBy) query.orderBy = params.orderBy;
  if (params.orderMode) query.orderMode = params.orderMode;
  if (params.include) query.include = params.include;
  return query;
}
