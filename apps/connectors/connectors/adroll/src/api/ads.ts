import type { ConnectorClient } from './client';
import type { Ad, AdCreateParams, ListParams, PaginatedResponse } from '../types';

export class AdsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(advertisableEid: string, params?: ListParams): Promise<PaginatedResponse<Ad>> {
    return this.client.get<PaginatedResponse<Ad>>('/api/v1/advertisable/get_ads', {
      advertisable: advertisableEid,
      ...params,
    });
  }

  async get(eid: string): Promise<Ad> {
    const resp = await this.client.get<{ results: Ad }>('/api/v1/ad/get', {
      ad: eid,
    });
    return resp.results;
  }

  async create(advertisableEid: string, data: AdCreateParams): Promise<Ad> {
    return this.client.post<Ad>('/api/v1/ad/create', {
      advertisable: advertisableEid,
      ...data,
    });
  }

  async edit(eid: string, data: Partial<AdCreateParams>): Promise<Ad> {
    return this.client.post<Ad>('/api/v1/ad/edit', {
      ad: eid,
      ...data,
    });
  }
}
