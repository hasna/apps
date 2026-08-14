import type { ConnectorClient } from './client';
import type {
  CampaignItem,
  CampaignItemCreateParams,
  CampaignItemUpdateParams,
  CollectionResponse,
} from '../types';

/**
 * Campaign item (creative) endpoints.
 * Base path: /backstage/api/1.0/{account_id}/campaigns/{campaign_id}/items/
 */
export class CampaignItemsApi {
  constructor(private readonly client: ConnectorClient) {}

  private base(accountId: string, campaignId: string): string {
    return `/${accountId}/campaigns/${campaignId}/items`;
  }

  async list(accountId: string, campaignId: string): Promise<CollectionResponse<CampaignItem>> {
    return this.client.get<CollectionResponse<CampaignItem>>(`${this.base(accountId, campaignId)}/`);
  }

  async get(accountId: string, campaignId: string, itemId: string): Promise<CampaignItem> {
    return this.client.get<CampaignItem>(`${this.base(accountId, campaignId)}/${itemId}/`);
  }

  async create(
    accountId: string,
    campaignId: string,
    data: CampaignItemCreateParams
  ): Promise<CampaignItem> {
    return this.client.post<CampaignItem>(`${this.base(accountId, campaignId)}/`, data);
  }

  async update(
    accountId: string,
    campaignId: string,
    itemId: string,
    data: CampaignItemUpdateParams
  ): Promise<CampaignItem> {
    return this.client.post<CampaignItem>(`${this.base(accountId, campaignId)}/${itemId}/`, data);
  }

  async remove(accountId: string, campaignId: string, itemId: string): Promise<CampaignItem> {
    return this.client.delete<CampaignItem>(`${this.base(accountId, campaignId)}/${itemId}/`);
  }
}
