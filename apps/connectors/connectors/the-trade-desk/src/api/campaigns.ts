import type { ConnectorClient } from './client';
import type { Campaign, JsonRecord, ListParams } from '../types';

export class CampaignsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<JsonRecord> {
    return this.client.get<JsonRecord>('/campaigns', params);
  }

  async get(campaignId: string): Promise<Campaign> {
    const encoded = encodeURIComponent(campaignId);
    return this.client.get<Campaign>(`/campaigns/${encoded}`);
  }

  async create(body: JsonRecord): Promise<Campaign> {
    return this.client.post<Campaign>('/campaigns', body);
  }
}
