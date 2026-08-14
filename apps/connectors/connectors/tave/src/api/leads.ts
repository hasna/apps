import type { ConnectorClient } from './client';
import type { CreateLeadParams, Lead, ListParams, ListResponse } from '../types';

function toQuery(params?: ListParams): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};
  if (params?.page !== undefined) query.page = params.page;
  if (params?.perPage !== undefined) query.per_page = params.perPage;
  if (params?.search) query.search = params.search;
  if (params?.status) query.status = params.status;
  return query;
}

export class LeadsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<ListResponse<Lead>> {
    return this.client.get<ListResponse<Lead>>('/leads', toQuery(params));
  }

  async get(id: string | number): Promise<Lead> {
    return this.client.get<Lead>(`/leads/${id}`);
  }

  async create(data: CreateLeadParams): Promise<Lead> {
    return this.client.post<Lead>('/leads', data as Record<string, unknown>);
  }
}
