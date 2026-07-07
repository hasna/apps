import type { ConnectorClient } from './client';
import type { Campaign, CampaignCreateParams } from '../types';

export class CampaignsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<Campaign[]> {
    const result = await this.client.get<Campaign[] | { campaigns?: Campaign[] }>('/campaigns');
    if (Array.isArray(result)) {
      return result;
    }
    return result.campaigns ?? [];
  }

  async get(id: string | number): Promise<Campaign> {
    return this.client.get<Campaign>(`/campaign/${id}`);
  }

  /**
   * Create a campaign via the legacy REST endpoint.
   * StackAdapt recommends GraphQL for new write integrations; use graphql() for advanced flows.
   */
  async create(data: CampaignCreateParams): Promise<Campaign> {
    return this.client.post<Campaign>('/campaign', data);
  }

  async update(id: string | number, data: CampaignCreateParams): Promise<Campaign> {
    return this.client.put<Campaign>(`/campaign/${id}`, data);
  }

  async search(query: string): Promise<Campaign[]> {
    const campaigns = await this.list();
    const needle = query.toLowerCase();
    return campaigns.filter((campaign) => {
      const name = String(campaign.name ?? '').toLowerCase();
      const id = String(campaign.id ?? '').toLowerCase();
      return name.includes(needle) || id.includes(needle);
    });
  }
}
