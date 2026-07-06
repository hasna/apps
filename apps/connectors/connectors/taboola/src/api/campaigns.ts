import type { ConnectorClient } from './client';
import type {
  Campaign,
  CampaignCreateParams,
  CampaignUpdateParams,
  CollectionResponse,
} from '../types';

/**
 * Campaign management endpoints.
 * Base path: /backstage/api/1.0/{account_id}/campaigns/
 * Taboola uses POST for both create and update.
 */
export class CampaignsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(accountId: string): Promise<CollectionResponse<Campaign>> {
    return this.client.get<CollectionResponse<Campaign>>(`/${accountId}/campaigns/`);
  }

  async get(accountId: string, campaignId: string): Promise<Campaign> {
    return this.client.get<Campaign>(`/${accountId}/campaigns/${campaignId}/`);
  }

  async create(accountId: string, data: CampaignCreateParams): Promise<Campaign> {
    return this.client.post<Campaign>(`/${accountId}/campaigns/`, data);
  }

  async update(accountId: string, campaignId: string, data: CampaignUpdateParams): Promise<Campaign> {
    return this.client.post<Campaign>(`/${accountId}/campaigns/${campaignId}/`, data);
  }

  async remove(accountId: string, campaignId: string): Promise<Campaign> {
    return this.client.delete<Campaign>(`/${accountId}/campaigns/${campaignId}/`);
  }
}
