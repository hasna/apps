import { WoodpeckerClient } from './client';
import type {
  Campaign,
  CampaignSummary,
  CreateCampaignParams,
  ListCampaignsParams,
  Prospect,
  ProspectSearchParams,
  RawRequestOptions,
  WebhooksResponse,
  WoodpeckerConfig,
} from '../types';

export { WoodpeckerClient, DEFAULT_BASE_URL } from './client';

export class Woodpecker {
  private readonly client: WoodpeckerClient;

  constructor(config: WoodpeckerConfig) {
    this.client = new WoodpeckerClient(config);
  }

  static fromEnv(): Woodpecker {
    const apiKey = process.env.WOODPECKER_API_KEY;
    if (!apiKey) {
      throw new Error('WOODPECKER_API_KEY environment variable is required');
    }
    return new Woodpecker({
      apiKey,
      baseUrl: process.env.WOODPECKER_BASE_URL,
    });
  }

  async listCampaigns(params: ListCampaignsParams = {}): Promise<CampaignSummary[]> {
    return this.client.get<CampaignSummary[]>('/v1/campaign_list', {
      status: params.status,
      id: params.id,
    });
  }

  async getCampaign(campaignId: number | string): Promise<Campaign> {
    return this.client.get<Campaign>(`/v2/campaigns/${campaignId}`);
  }

  async createCampaign(params: CreateCampaignParams): Promise<Campaign> {
    return this.client.post<Campaign>('/v2/campaigns', { ...params });
  }

  async listEvents(): Promise<WebhooksResponse> {
    return this.client.get<WebhooksResponse>('/v2/webhooks');
  }

  async searchProspects(params: ProspectSearchParams): Promise<Prospect[]> {
    const { search, ...query } = params;
    return this.client.get<Prospect[]>('/v1/prospects', {
      search,
      campaigns_details: query.campaigns_details,
      page: query.page,
      per_page: query.per_page,
      sort: query.sort,
      id: query.id,
      status: query.status,
      campaigns_id: query.campaigns_id,
      contacted: query.contacted,
      interested: query.interested,
    });
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    return this.client.request<T>(options.path, {
      method: options.method,
      params: options.params,
      body: options.body,
    });
  }

  getClient(): WoodpeckerClient {
    return this.client;
  }
}
