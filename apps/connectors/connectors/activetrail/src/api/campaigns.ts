import type { ConnectorClient } from './client';
import type { Campaign, CampaignCreateParams, CampaignUpdateParams, CampaignSchedule, ListParams } from '../types';

export class CampaignsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<Campaign[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<Campaign[]>('/campaigns', queryParams);
  }

  async get(campaignId: number): Promise<Campaign> {
    return this.client.get<Campaign>(`/campaigns/${campaignId}`);
  }

  async create(params: CampaignCreateParams): Promise<Campaign> {
    return this.client.post<Campaign>('/campaigns', params);
  }

  async update(campaignId: number, params: CampaignUpdateParams): Promise<void> {
    await this.client.put(`/campaigns/${campaignId}`, params);
  }

  async delete(campaignId: number): Promise<void> {
    await this.client.delete(`/campaigns/${campaignId}`);
  }

  async getTemplate(campaignId: number): Promise<unknown> {
    return this.client.get<unknown>(`/campaigns/${campaignId}/template`);
  }

  async updateTemplate(campaignId: number, htmlContent: string): Promise<void> {
    await this.client.put(`/campaigns/${campaignId}/template`, { HtmlContent: htmlContent });
  }

  async getSchedule(campaignId: number): Promise<CampaignSchedule> {
    return this.client.get<CampaignSchedule>(`/campaigns/${campaignId}/scheduling`);
  }

  async updateSchedule(campaignId: number, schedule: CampaignSchedule): Promise<void> {
    await this.client.put(`/campaigns/${campaignId}/scheduling`, schedule);
  }

  async getSentCampaigns(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<unknown>('/campaigns/SentCampaigns', queryParams);
  }
}
