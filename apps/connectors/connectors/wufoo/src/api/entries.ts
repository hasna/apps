import type { WufooClient } from './client';
import { encodeResourceId } from './client';
import type {
  EntryListParams,
  WufooEntriesResponse,
  WufooEntryCountResponse,
  WufooSubmitEntryResponse,
} from '../types';

function toEntryQueryParams(params?: EntryListParams): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};
  if (!params) return query;

  if (params.page !== undefined) query.page = params.page;
  if (params.limit !== undefined) query.limit = params.limit;
  if (params.pretty !== undefined) query.pretty = params.pretty;
  if (params.sort) query.sort = params.sort;
  if (params.sortDirection) query.sortDirection = params.sortDirection;

  if (params.filters) {
    Object.entries(params.filters).forEach(([key, value]) => {
      query[key] = value;
    });
  }

  return query;
}

export class EntriesApi {
  constructor(private readonly client: WufooClient) {}

  async list(formId: string, params?: EntryListParams): Promise<WufooEntriesResponse> {
    const id = encodeResourceId(formId);
    return this.client.get<WufooEntriesResponse>(
      `/forms/${id}/entries.json`,
      toEntryQueryParams(params),
    );
  }

  async count(formId: string, params?: EntryListParams): Promise<WufooEntryCountResponse> {
    const id = encodeResourceId(formId);
    return this.client.get<WufooEntryCountResponse>(
      `/forms/${id}/entries/count.json`,
      toEntryQueryParams(params),
    );
  }

  async submit(
    formId: string,
    fields: Record<string, string | number | boolean | undefined>,
  ): Promise<WufooSubmitEntryResponse> {
    const id = encodeResourceId(formId);
    return this.client.postForm<WufooSubmitEntryResponse>(`/forms/${id}/entries.json`, fields);
  }
}
