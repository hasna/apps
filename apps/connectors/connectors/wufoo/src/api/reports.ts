import type { WufooClient } from './client';
import { encodeResourceId } from './client';
import type {
  EntryListParams,
  ListParams,
  WufooEntriesResponse,
  WufooEntryCountResponse,
  WufooFieldsResponse,
  WufooReportResponse,
  WufooReportsResponse,
  WufooWidgetsResponse,
} from '../types';

function toListParams(params?: ListParams): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};
  if (!params) return query;
  if (params.page !== undefined) query.page = params.page;
  if (params.limit !== undefined) query.limit = params.limit;
  if (params.pretty !== undefined) query.pretty = params.pretty;
  return query;
}

function toEntryParams(params?: EntryListParams): Record<string, string | number | boolean | undefined> {
  const query = toListParams(params);
  if (!params) return query;
  if (params.sort) query.sort = params.sort;
  if (params.sortDirection) query.sortDirection = params.sortDirection;
  if (params.filters) {
    Object.entries(params.filters).forEach(([key, value]) => {
      query[key] = value;
    });
  }
  return query;
}

export class ReportsApi {
  constructor(private readonly client: WufooClient) {}

  async list(params?: ListParams): Promise<WufooReportsResponse> {
    return this.client.get<WufooReportsResponse>('/reports.json', toListParams(params));
  }

  async get(reportId: string): Promise<WufooReportResponse> {
    const id = encodeResourceId(reportId);
    return this.client.get<WufooReportResponse>(`/reports/${id}.json`);
  }

  async listEntries(reportId: string, params?: EntryListParams): Promise<WufooEntriesResponse> {
    const id = encodeResourceId(reportId);
    return this.client.get<WufooEntriesResponse>(
      `/reports/${id}/entries.json`,
      toEntryParams(params),
    );
  }

  async countEntries(reportId: string, params?: EntryListParams): Promise<WufooEntryCountResponse> {
    const id = encodeResourceId(reportId);
    return this.client.get<WufooEntryCountResponse>(
      `/reports/${id}/entries/count.json`,
      toEntryParams(params),
    );
  }

  async listFields(reportId: string): Promise<WufooFieldsResponse> {
    const id = encodeResourceId(reportId);
    return this.client.get<WufooFieldsResponse>(`/reports/${id}/fields.json`);
  }

  async listWidgets(reportId: string): Promise<WufooWidgetsResponse> {
    const id = encodeResourceId(reportId);
    return this.client.get<WufooWidgetsResponse>(`/reports/${id}/widgets.json`);
  }
}
