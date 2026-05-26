import type { ConnectorClient } from './client';
import type { ListParams } from '../types';

export class CampaignsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.offset) queryParams.offset = params.offset;
    if (params?.filters) {
      for (const [key, value] of Object.entries(params.filters)) {
        queryParams[key] = value;
      }
    }
    return this.client.get<unknown>('/campaigns', queryParams);
  }

  async get(campaignId: string): Promise<unknown> {
    return this.client.get<unknown>(`/campaigns/${campaignId}`);
  }

  async listLinks(campaignId: string): Promise<unknown> {
    return this.client.get<unknown>(`/campaigns/${campaignId}/links`);
  }

  async listMessages(campaignId: string): Promise<unknown> {
    return this.client.get<unknown>(`/campaigns/${campaignId}/campaignMessages`);
  }
}
