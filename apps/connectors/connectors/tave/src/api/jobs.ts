import type { ConnectorClient } from './client';
import type { Job, ListParams, ListResponse } from '../types';

function toQuery(params?: ListParams): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};
  if (params?.page !== undefined) query.page = params.page;
  if (params?.perPage !== undefined) query.per_page = params.perPage;
  if (params?.search) query.search = params.search;
  if (params?.status) query.status = params.status;
  return query;
}

export class JobsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<ListResponse<Job>> {
    return this.client.get<ListResponse<Job>>('/jobs', toQuery(params));
  }

  async get(id: string | number): Promise<Job> {
    return this.client.get<Job>(`/jobs/${id}`);
  }
}
