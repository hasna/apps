import type { ConnectorClient } from './client';
import type {
  Campaign,
  CampaignCreateParams,
  CampaignListParams,
  CampaignReportParams,
} from '../types';

export class CampaignsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: CampaignListParams): Promise<unknown> {
    return this.client.get('/campaigns', params);
  }

  async get(id: string | number): Promise<Campaign> {
    return this.client.get<Campaign>(`/campaigns/${encodeURIComponent(String(id))}`);
  }

  async create(data: CampaignCreateParams): Promise<Campaign> {
    return this.client.post<Campaign>('/campaigns', data);
  }

  async update(id: string | number, data: Record<string, unknown>): Promise<Campaign> {
    return this.client.patch<Campaign>(`/campaigns/${encodeURIComponent(String(id))}`, data);
  }

  async delete(id: string | number): Promise<unknown> {
    return this.client.delete(`/campaigns/${encodeURIComponent(String(id))}`);
  }

  async run(id: string | number): Promise<unknown> {
    return this.client.post(`/campaigns/${encodeURIComponent(String(id))}/run`, {});
  }

  async pause(id: string | number): Promise<unknown> {
    return this.client.post(`/campaigns/${encodeURIComponent(String(id))}/pause`, {});
  }

  async report(id: string | number, params?: CampaignReportParams): Promise<unknown> {
    return this.client.get(`/campaigns/${encodeURIComponent(String(id))}/report`, params);
  }
}
