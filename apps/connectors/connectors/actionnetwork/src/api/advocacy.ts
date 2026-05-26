import type { ConnectorClient } from './client';
import type { AdvocacyCampaign, AdvocacyCampaignCreateParams, ListParams } from '../types';

export class AdvocacyApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    if (params?.filter) queryParams.filter = params.filter;
    return this.client.get<unknown>('/advocacy_campaigns', queryParams);
  }

  async get(campaignId: string): Promise<AdvocacyCampaign> {
    return this.client.get<AdvocacyCampaign>(`/advocacy_campaigns/${campaignId}`);
  }

  async create(params: AdvocacyCampaignCreateParams): Promise<AdvocacyCampaign> {
    return this.client.post<AdvocacyCampaign>('/advocacy_campaigns', params);
  }

  async update(campaignId: string, params: Partial<AdvocacyCampaignCreateParams>): Promise<AdvocacyCampaign> {
    return this.client.put<AdvocacyCampaign>(`/advocacy_campaigns/${campaignId}`, params);
  }

  async listOutreaches(campaignId: string, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    return this.client.get<unknown>(`/advocacy_campaigns/${campaignId}/outreaches`, queryParams);
  }
}
