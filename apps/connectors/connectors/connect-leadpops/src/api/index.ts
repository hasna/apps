// LeadPops Connector — Lead generation for mortgage and real estate
import { LeadPopsClient } from './client';
import type { LeadPopsConfig, LPLead, LPLeadList, LPFunnel, LPCampaign } from '../types';
export { LeadPopsClient } from './client';

export class LeadPops {
  private readonly client: LeadPopsClient;
  constructor(config: LeadPopsConfig) { this.client = new LeadPopsClient(config); }
  static fromEnv(): LeadPops {
    const apiKey = process.env.LEADPOPS_API_KEY;
    if (!apiKey) throw new Error('LEADPOPS_API_KEY is required');
    return new LeadPops({ apiKey });
  }

  async listLeads(options?: { page?: number; per_page?: number; status?: string; source?: string; funnel_id?: string }): Promise<LPLeadList> {
    return this.client.request<LPLeadList>('/leads', { params: { page: options?.page, per_page: options?.per_page, status: options?.status, source: options?.source, funnel_id: options?.funnel_id } });
  }
  async getLead(leadId: string): Promise<LPLead> { return this.client.request<LPLead>(`/leads/${leadId}`); }
  async updateLead(leadId: string, data: { status?: string; custom_fields?: Record<string, string> }): Promise<LPLead> {
    return this.client.request<LPLead>(`/leads/${leadId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteLead(leadId: string): Promise<void> { await this.client.request(`/leads/${leadId}`, { method: 'DELETE' }); }

  async listFunnels(): Promise<LPFunnel[]> { return this.client.request<LPFunnel[]>('/funnels'); }
  async getFunnel(funnelId: string): Promise<LPFunnel> { return this.client.request<LPFunnel>(`/funnels/${funnelId}`); }

  async listCampaigns(): Promise<LPCampaign[]> { return this.client.request<LPCampaign[]>('/campaigns'); }
  async getCampaign(campaignId: string): Promise<LPCampaign> { return this.client.request<LPCampaign>(`/campaigns/${campaignId}`); }

  getClient(): LeadPopsClient { return this.client; }
}
