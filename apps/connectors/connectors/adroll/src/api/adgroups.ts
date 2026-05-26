import type { ConnectorClient } from './client';
import type { Adgroup, AdgroupCreateParams, ListParams, PaginatedResponse } from '../types';

export class AdgroupsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(campaignEid: string, params?: ListParams): Promise<PaginatedResponse<Adgroup>> {
    return this.client.get<PaginatedResponse<Adgroup>>('/api/v1/campaign/get_adgroups', {
      campaign: campaignEid,
      ...params,
    });
  }

  async get(eid: string): Promise<Adgroup> {
    const resp = await this.client.get<{ results: Adgroup }>('/api/v1/adgroup/get', {
      adgroup: eid,
    });
    return resp.results;
  }

  async create(data: AdgroupCreateParams): Promise<Adgroup> {
    return this.client.post<Adgroup>('/api/v1/adgroup/create', data);
  }

  async edit(eid: string, data: Partial<AdgroupCreateParams>): Promise<Adgroup> {
    return this.client.post<Adgroup>('/api/v1/adgroup/edit', {
      adgroup: eid,
      ...data,
    });
  }
}
