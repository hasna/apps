import type { ConnectorClient } from './client';
import type { Advertisable, AdvertisableCreateParams, ListParams, PaginatedResponse } from '../types';

export class AdvertisablesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(organizationEid: string, params?: ListParams): Promise<PaginatedResponse<Advertisable>> {
    return this.client.get<PaginatedResponse<Advertisable>>('/api/v1/organization/get_advertisables', {
      organization: organizationEid,
      ...params,
    });
  }

  async get(eid: string): Promise<Advertisable> {
    const resp = await this.client.get<{ results: Advertisable }>('/api/v1/advertisable/get', {
      advertisable: eid,
    });
    return resp.results;
  }

  async create(organizationEid: string, data: AdvertisableCreateParams): Promise<Advertisable> {
    return this.client.post<Advertisable>('/api/v1/advertisable/create', {
      organization: organizationEid,
      ...data,
    });
  }

  async edit(eid: string, data: Partial<AdvertisableCreateParams>): Promise<Advertisable> {
    return this.client.post<Advertisable>('/api/v1/advertisable/edit', {
      advertisable: eid,
      ...data,
    });
  }
}
