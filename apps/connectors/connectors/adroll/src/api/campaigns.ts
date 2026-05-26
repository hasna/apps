import type { ConnectorClient } from './client';
import type { Campaign, CampaignCreateParams, CampaignEditParams, ListParams, PaginatedResponse } from '../types';

export class CampaignsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(advertisableEid: string, params?: ListParams): Promise<PaginatedResponse<Campaign>> {
    return this.client.get<PaginatedResponse<Campaign>>('/api/v1/advertisable/get_campaigns', {
      advertisable: advertisableEid,
      ...params,
    });
  }

  async get(eid: string): Promise<Campaign> {
    const resp = await this.client.get<{ results: Campaign }>('/api/v1/campaign/get', {
      campaign: eid,
    });
    return resp.results;
  }

  async create(advertisableEid: string, data: CampaignCreateParams): Promise<Campaign> {
    return this.client.post<Campaign>('/api/v1/campaign/create', {
      advertisable: advertisableEid,
      ...data,
    });
  }

  async edit(eid: string, data: CampaignEditParams): Promise<Campaign> {
    return this.client.post<Campaign>('/api/v1/campaign/edit', {
      campaign: eid,
      ...data,
    });
  }
}
